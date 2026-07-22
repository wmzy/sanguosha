// 界护驾(界曹操·主公技):
//   主公技,其他魏势力角色可以在你需要时代替你使用或打出【闪】(视为由你使用或打出);
//   每回合限一次,当其他魏势力角色于其回合外使用或打出【闪】时,
//   其可以令你摸一张牌。
//
// OL 官方:
//   "主公技,其他魏势力角色可以在你需要时代替你使用或打出【闪】(视为由你使用或打出);
//    每回合限一次,当其他魏势力角色于其回合外使用或打出【闪】时,
//    其可以令你摸一张牌。"
//
// 与标护驾区别:
//   - 标护驾:仅主动技形式(曹操被询问闪 → 逐个询问魏角色代出闪)。
//   - 界护驾:① 沿用标护驾主动技机制;② 新增被动触发——魏角色回合外用闪
//     (使用/打出/护驾代出),其可令曹操摸1张(每回合限一次,选择权在该魏角色)。
//
// 实现要点:
//   - 主动技 'respond' 部分:逐字复用标护驾逻辑,ownerId===0(主公固定0号位)门槛不变。
//   - 新增 after-hook(移动牌):魏角色回合外打出闪(手牌→处理区)→ 询问是否令曹操摸1。
//     · "使用/打出闪" 均会触发 移动牌 atom(闪 use 流程必经),覆盖主路径。
//     · "每回合限一次":用 state.turn.vars[PER_TURN_VAR](回合结束 atom 自动清空 turn.vars)。
//   - 跨座次 respond 注册:选择权在魏角色(非曹操),须为每个魏角色座次注册 respond,
//     否则其 dispatch 找不到 action(同标护驾 跨座次注册模式)。
//   - 独立界版文件,注册键 '界护驾'(与标护驾键隔离,不修改标护驾)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

// localVars keys(标护驾主技路径)
const DODGE_PLAYED_VAR = '界护驾/闪出';
// localVars keys(界护驾新增被动触发)
const REQUEST_TYPE = '界护驾/drawChoice';
const CONFIRMED_VAR = '界护驾/confirmed';
// 每回合限一次标记:存 state.turn.vars(回合结束 atom 清空 turn.vars → 自动复位)
const PER_TURN_VAR = '界护驾/triggered';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界护驾',
    description:
      '主公技:魏势力角色可代你使用或打出闪;每回合限一次,魏角色回合外用闪时可令你摸1张',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const offs: Array<() => void> = [];

  // ── 主技 respond:曹操在询问闪时选择护驾 ──
  offs.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, _params: Record<string, Json>): string | null => {
        // 主公技:仅曹操为主公(座次 0)时可用
        if (ownerId !== 0) return '非主公不能发动护驾';
        // 必须有询问闪 pending,target 是曹操
        const slot = st.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        if (slot.atom.type !== '询问闪') return '当前不是出闪窗口';
        const self = st.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';
        // 必须有其他魏势力存活角色(有手牌)
        const hasWeiAllies = st.players.some(
          (p) =>
            p.alive &&
            p.index !== ownerId &&
            p.faction === '魏' &&
            p.hand.length > 0,
        );
        if (!hasWeiAllies) return '没有可出闪的魏势力角色';
        return null;
      },
      async (st: GameState, _params: Record<string, Json>): Promise<void> => {
        // 按座次顺序逐个询问魏势力角色
        const numPlayers = st.players.length;
        for (let offset = 1; offset < numPlayers; offset++) {
          const allyIdx = (ownerId + offset) % numPlayers;
          const ally = st.players[allyIdx];
          if (!ally?.alive) continue;
          if (ally.faction !== '魏') continue;
          if (ally.hand.length === 0) continue;

          // 询问该魏势力角色是否打出闪
          delete st.localVars[DODGE_PLAYED_VAR];
          await applyAtom(st, {
            type: '请求回应',
            requestType: '界护驾/出闪',
            target: allyIdx,
            prompt: {
              type: 'useCard',
              title: `护驾:曹操(${st.players[ownerId]?.name ?? `P${ownerId}`})需要闪,是否打出一张闪?`,
              cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
            },
            timeout: 15,
          });

          const dodgeCardId = st.localVars[DODGE_PLAYED_VAR] as string | undefined;
          delete st.localVars[DODGE_PLAYED_VAR];

          if (dodgeCardId && ally.hand.includes(dodgeCardId)) {
            // 该角色出闪:移入处理区(视为曹操打出)
            await applyAtom(st, {
              type: '移动牌',
              cardId: dodgeCardId,
              from: { zone: '手牌', player: allyIdx },
              to: { zone: '处理区' },
            });
            // 有人出闪,护驾结束
            return;
          }
          // 该角色拒绝,继续询问下一个
        }
        // 全部拒绝:处理区无闪,execute 结束,杀正常造成伤害
      },
    ),
  );

  // ── 移动牌 after hook:魏角色回合外打出闪 → 询问是否令曹操摸1张 ──
  offs.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '移动牌',
      async (ctx): Promise<void> => {
        // 主公技:仅曹操为主公(座次 0)时生效
        if (ownerId !== 0) return;
        const atom = ctx.atom;
        // 必须 手牌→处理区(打出/使用闪的通用路径)
        if (atom.from.zone !== '手牌') return;
        if (atom.to.zone !== '处理区') return;
        const sourceIdx = atom.from.player;
        if (typeof sourceIdx !== 'number') return;
        // 必须是其他魏势力角色(非曹操本人)
        if (sourceIdx === ownerId) return;
        const source = ctx.state.players[sourceIdx];
        if (!source?.alive) return;
        if (source.faction !== '魏') return;
        // 必须是 闪(检测 cardMap,兼容倾国等转化后的闪卡)
        const card = ctx.state.cardMap[atom.cardId];
        if (!card || card.name !== '闪') return;
        // 必须是该魏角色"回合外"(当前回合不是其本人回合)
        if (ctx.state.currentPlayerIndex === sourceIdx) return;
        // 曹操需存活(否则无人摸牌)
        const lord = ctx.state.players[ownerId];
        if (!lord?.alive) return;
        // 每回合限一次(本回合已触发过则跳过)
        if (ctx.state.turn.vars[PER_TURN_VAR] === true) return;

        // 标记本回合已触发(同步写 turn.vars 防止 hook 重入;turn.vars 由回合结束自动清空)
        ctx.state.turn.vars[PER_TURN_VAR] = true;
        await applyAtom(ctx.state, {
          type: '回合用量',
          player: ownerId,
          key: PER_TURN_VAR,
          value: true,
        });

        // 询问魏角色是否令曹操摸1张(描述"可以"=可选;选择权在该魏角色)
        delete ctx.state.localVars[CONFIRMED_VAR];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: REQUEST_TYPE,
          target: sourceIdx,
          prompt: {
            type: 'confirm',
            title: `界护驾:是否令${lord.name}摸一张牌?`,
            confirmLabel: '令曹操摸牌',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 30,
        });

        if (ctx.state.localVars[CONFIRMED_VAR] === true) {
          // 魏角色选择发动 → 曹操摸 1 张
          await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        }
      },
    ),
  );

  // ── 为所有其他魏势力角色注册 respond(回应护驾代出闪 + 回应"是否令曹操摸牌")──
  // 选择权在魏角色(其他魏角色,非曹操),respond 须注册到其座次,否则其 dispatch 找不到
  // action(默认 respond 只注册在 owner=曹操 座次)。同标护驾 跨座次注册模式。
  for (const p of state.players) {
    const pid = p.index;
    if (pid === ownerId) continue;
    if (p.faction !== '魏') continue;
    const off = registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const a = slot.atom as Record<string, unknown>;
        if (a['type'] !== '请求回应') return '当前不需要回应';
        const requestType = a['requestType'] as string;
        if (requestType === '界护驾/出闪') {
          // 护驾代出闪:有 cardId 必须是手牌中的闪
          const cardId = params.cardId as string | undefined;
          if (cardId) {
            if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
            if (st.cardMap[cardId]?.name !== '闪') return '只能打出闪';
          }
          return null;
        }
        if (requestType === REQUEST_TYPE) {
          // 回应"是否令曹操摸牌"
          return null;
        }
        return '当前不是界护驾询问';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const a = slot.atom as Record<string, unknown>;
        const requestType = a['requestType'] as string;
        if (requestType === '界护驾/出闪') {
          const cardId = params.cardId as string | undefined;
          if (cardId) {
            st.localVars[DODGE_PLAYED_VAR] = cardId;
          }
          // cardId 为空 = 不出闪(拒绝护驾)
        } else if (requestType === REQUEST_TYPE) {
          st.localVars[CONFIRMED_VAR] =
            params.choice === true || params.confirmed === true;
        }
      },
    );
    offs.push(off);
  }

  return () => {
    for (const off of offs) off();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 曹操的护驾 action:被询问闪时激活
  api.defineAction('respond', {
    label: '界护驾',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '护驾:令魏势力角色替你出闪?',
      confirmLabel: '护驾',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      if ((slot.atom as { type: string }).type !== '询问闪') return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      // 势力检查由后端 validate 处理(GameView 不暴露 faction)
      // 此处仅检查当前被询问闪,前端会渲染护驾按钮;后端拒绝无魏势力角色的场景
      return true;
    },
  });

  // 魏势力角色的护驾 respond(收到护驾询问时渲染出闪 UI)
  api.defineAction('respond', {
    label: '护驾·出闪',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '护驾:打出一张闪?',
      cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type !== '请求回应') return false;
      if (atom.requestType !== '界护驾/出闪') return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      return true;
    },
  });

  // 魏势力角色的护驾 respond(收到"是否令曹操摸牌"询问时渲染按钮)
  api.defineAction('respond', {
    label: '界护驾·摸牌',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '界护驾:是否令曹操摸一张牌?',
      confirmLabel: '令曹操摸牌',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type !== '请求回应') return false;
      if (atom.requestType !== REQUEST_TYPE) return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      return true;
    },
  });

  return;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
