// 界救援(界孙权·主公技):
//   其他吴势力角色于其回合内回复体力时,若其体力值大于等于你,
//   则其可以改为令你回复1点体力,然后其摸一张牌。
//
// OL 官方(hero/442)逐字:
//   "其他吴势力角色于其回合内回复体力时,若其体力值大于等于你,
//    则其可以改为令你回复1点体力,然后其摸一张牌。"
//
// 与标救援区别:
//   - 标版:孙权濒死求桃,其他吴角色出桃救孙权 → 该角色(救援者)额外回复1点体力。(锁定)
//   - 界版:其他吴角色【在其自己回合内】回复体力时(任意回复体力事件,非濒死求桃),
//     若其体力≥孙权,其【可选】改为令孙权回1血(替代其原本回复),然后其摸1张。
//
// "改为"语义(OL FAQ):该角色本次不回复体力,改为孙权回复1点体力,然后该角色摸1张。
//   故用 before-hook 拦截原「回复体力」→ cancel 原回复 → 对孙权 回复体力+1 → 该角色 摸牌+1。
//   (克己/享乐 同为 before-hook 内 applyAtom 后 return cancel 的先例。)
//
// 关键点:
//   - 主公技:仅孙权为主公(ownerId===0,主公固定 0 号位,见 选将.ts)时生效。
//     参考激将/若愚/标救援的主公判定。非主公座次时 hook 注册但不触发。
//   - 触发对象:回复体力的 target 是"其他吴势力角色"(≠孙权 且 faction==='吴')。
//   - "于其回合内":state.currentPlayerIndex === atom.target(该角色自己回合)。
//   - "若其体力值大于等于你":target 当前体力(此时为 before-hook,即回复前)≥ 孙权当前体力。
//   - "其可以":可选,询问 target(回复者)是否发动;选择权在该角色,故 respond 注册到
//     所有吴势力角色座次(同护驾跨座次注册模式)。
//   - 嵌套安全:改对孙权的 回复体力 target=孙权(=ownerId),本 hook 条件 target≠ownerId → 不重入。
//   - 与濒死求桃无关:濒死求桃时 target=孙权(被救者),本 hook 要求 target≠孙权,
//     故天然不与濒死求桃场景冲突,无需检查 求桃/已救 标志。
import type { GameState, HookResult, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

/** 界救援问询的 requestType(隔离 respond 路由) */
const REQUEST_TYPE = '界救援/choose';
/** 回复者回应结果:confirm=true 则改为孙权回血 + 其摸一张 */
const CONFIRMED_VAR = '界救援/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界救援',
    description:
      '主公技:其他吴势力角色于其回合内回复体力时,若其体力≥你,其可改为令你回复1点体力,然后其摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // before-hook:其他吴角色在其回合内回复体力时,拦截并询问是否改为孙权回血。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '回复体力',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 主公技:仅孙权为主公(座次 0)时生效
      if (ownerId !== 0) return;
      const target = atom.target;
      if (typeof target !== 'number') return;
      // 仅"其他角色"(target≠孙权)回复体力时触发
      if (target === ownerId) return;
      // 必须是该角色自己的回合("于其回合内")
      if (ctx.state.currentPlayerIndex !== target) return;

      const healer = ctx.state.players[target];
      const sunquan = ctx.state.players[ownerId];
      if (!healer?.alive || !sunquan?.alive) return;
      // 仅吴势力角色
      if (healer.faction !== '吴') return;
      // 条件:其体力值 ≥ 孙权体力值(此时 before-hook,即回复前当前体力)
      if (healer.health < sunquan.health) return;

      // 询问回复者是否改为令孙权回1血(描述"可以"= 可选)
      delete ctx.state.localVars[CONFIRMED_VAR];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: REQUEST_TYPE,
        target,
        prompt: {
          type: 'confirm',
          title: `界救援:是否改为令${sunquan.name}回复1点体力,然后你摸一张牌?`,
          confirmLabel: '改为救援',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 30,
      });

      if (ctx.state.localVars[CONFIRMED_VAR] === true) {
        // "改为":该角色本次不回血,改为孙权回复1点体力,然后该角色摸1张牌。
        await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
        await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
        return { kind: 'cancel' };
      }
      // 拒绝/超时 → 原回复照常进行(pass)
    },
  );

  // 为所有其他吴势力角色注册 respond(回应"是否改为孙权回血"询问)。
  // 选择权在回复者(其他吴角色),respond 须注册到其座次,否则其 dispatch 找不到 action
  // (默认 respond 只注册在 owner=孙权 座次)。同护驾为魏势力角色注册 respond 的模式。
  const offs: Array<() => void> = [];
  for (const p of state.players) {
    const pid = p.index;
    if (pid === ownerId) continue;
    if (p.faction !== '吴') continue;
    const off = registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, _params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const a = slot.atom as Record<string, unknown>;
        if (a['type'] !== '请求回应') return '当前不需要回应';
        if (a['requestType'] !== REQUEST_TYPE) return '当前不是界救援询问';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        st.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
      },
    );
    offs.push(off);
  }

  return () => {
    for (const off of offs) off();
  };
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
