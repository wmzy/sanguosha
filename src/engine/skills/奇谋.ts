// 奇谋(界魏延·蜀·限定技,OL hero/456 官方逐字):
//   "限定技,出牌阶段,你可以失去任意点体力并摸X张牌(X为你以此法失去的体力值),
//    然后你本回合计算与其他角色的距离-X且使用【杀】的限制次数+X。"
//
// 实现(use action + 回合内增益,乱武/武烈/界鞬出 同构):
//   - use action(主动,限定技):出牌阶段、自己回合、无阻塞 pending、存活、体力≥1、未使用过。
//   - execute:
//       1. 请求回应('奇谋/选X', chooseOption 1..当前体力)选 X;
//          超时/无效 → 直接返回,限定技不消耗(标记在确认 X 之后才写,同武烈)。
//       2. 标记 player.vars['奇谋/used']=true(整局一次,持久限定技走后端 validate 拦截,
//          对齐乱武/界乱武约定——turnUsage 每回合清空,不能承载整局标记)。
//       3. 失去 X 点体力(X=当前体力会进入濒死求桃;失血致死且无人救 → 后续效果不发)。
//       4. 存活 → 摸 X 张牌。
//       5. 本回合距离 -X:state 侧 vars['距离/进攻修正'] += X
//          + 加标记(mark '奇谋/距离', distanceVars.attackMod)同步 view(界义从/屯田 同构)。
//       6. 本回合使用【杀】限制次数 +X:turn.vars['奇谋/extra']=X 驱动
//          registerSlashExtraProvider(界鞬出/决堰 同构,回合结束随 turn.vars 自动清零)
//          + 「回合用量」投影 slashExtraKey('奇谋') 供前端 viewSlashMax 推断(天义/界将驰 同构)。
//   - 回合结束 after-hook(atom.player===owner):还原距离修正。
//     X 存 player.vars['奇谋/距离加成'](无自动清理后缀)——after-hook 在 回合结束.apply
//     清空 turn.vars 之后触发,不能读 turn.vars(决堰移除临时集智已验证该顺序)。
//
// 关键点:
//   - 限定技标记在 X 确认后写:选X超时/取消不消耗限定技。
//   - X ∈ [1, 当前体力]:X=当前体力 → 濒死(求桃),被救回仍继续摸牌/增益(官方"然后"语义)。
//   - 距离修正单一 number 槽位是引擎既有约定(马术+进攻马同理):读现值叠加、按 X 还原,
//     不引入新的累加机制。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, registerAfterHook, hasBlockingPending } from '../core/skill';
import { registerSlashExtraProvider } from '../rules/slash-quota';
import { defaultPlayActive } from '../rules/action-active';
import {
  DISTANCE_ATTACK_MOD_KEY as ATTACK_KEY,
  getDistanceAttackMod,
  slashExtraKey,
} from '../rules/vars-keys';

/** 限定技已用标记(player.vars,整局一次,无自动清理后缀) */
const USED_KEY = '奇谋/used';
/** 选X问询 requestType(前缀=skillId) */
const X_REQUEST = '奇谋/选X';
/** localVars key:选X结果(number,respond 写,execute 读) */
const X_KEY = '奇谋/x';
/** turn.vars key:本回合出杀上限加成(回合结束自动清空) */
const EXTRA_KEY = '奇谋/extra';
/** player.vars key:本回合距离加成 X(回合结束 after-hook 还原;无自动清理后缀) */
const BOOST_KEY = '奇谋/距离加成';
/** UI 可见的增益指示 mark;同时用作 view 距离同步的 bookend(界义从 同构) */
const BOOST_MARK_ID = '奇谋/距离';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '奇谋',
    description:
      '限定技,出牌阶段,你可以失去任意点体力并摸等量的牌,然后本回合你计算与其他角色的距离-X且使用【杀】的限制次数+X(X为失去的体力值)',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(魏延主动发动)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, _params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (!st.players[ownerId]?.alive) return '玩家不存在或已死亡';
        if (st.players[ownerId].vars[USED_KEY]) return '奇谋已使用过(限定技)';
        if (st.players[ownerId].health < 1) return '没有体力可失去';
        return null;
      },
      async (st: GameState, _params: Record<string, Json>) => {
        const me = st.players[ownerId];
        const hp = me.health;

        // 1) 选 X(1..当前体力,chooseOption 动态 options)。超时/无效 → 返回,不消耗限定技。
        delete st.localVars[X_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: X_REQUEST,
          target: ownerId,
          prompt: {
            type: 'chooseOption',
            title: `奇谋:失去几点体力?(1-${hp})`,
            description:
              '失去 X 点体力并摸 X 张牌,然后本回合你计算与其他角色的距离-X且使用【杀】的限制次数+X',
            options: Array.from({ length: hp }, (_, i) => ({
              value: String(i + 1),
              label: `失去 ${i + 1} 点体力`,
            })),
          },
          defaultChoice: '1' as unknown as Json,
          timeout: 30,
        });
        const x = st.localVars[X_KEY];
        delete st.localVars[X_KEY];
        if (typeof x !== 'number' || x < 1 || x > hp) return; // 超时/无效 → 不消耗

        // 2) 限定技标记:确认 X 后写(整局一次)
        me.vars[USED_KEY] = true;

        await pushFrame(st, '奇谋', ownerId, { x });
        try {
          // 3) 失去 X 点体力(=当前体力时进入濒死;失血致死且无人救 → 后续效果不发)
          await applyAtom(st, { type: '失去体力', target: ownerId, amount: x });
          if (!st.players[ownerId]?.alive) return;

          // 4) 摸 X 张牌
          await applyAtom(st, { type: '摸牌', player: ownerId, count: x });

          // 5) 本回合距离 -X:state 侧 vars + view 侧 加标记 distanceVars 通道
          const newMod = (getDistanceAttackMod(me.vars) ?? 0) + x;
          me.vars[ATTACK_KEY] = newMod;
          me.vars[BOOST_KEY] = x;
          await applyAtom(st, {
            type: '加标记',
            player: ownerId,
            mark: { id: BOOST_MARK_ID, scope: ownerId, payload: { x } },
            distanceVars: { attackMod: newMod },
          });

          // 6) 本回合使用【杀】限制次数 +X:turn.vars 驱动 provider + view 投影
          st.turn.vars[EXTRA_KEY] = x;
          await applyAtom(st, {
            type: '回合用量',
            player: ownerId,
            key: slashExtraKey('奇谋'),
            value: x,
          });
        } finally {
          await popFrame(st);
        }
      },
    ),
  );

  // ── respond:选 X(注册到 ownerId 座次,respondInfo 按 requestType 前缀路由)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应' || atom.requestType !== X_REQUEST) return '当前不是奇谋询问';
        const hp = st.players[ownerId]?.health ?? 0;
        const n = Number(params.option);
        if (!Number.isInteger(n) || n < 1 || n > hp) return `请选择 1-${hp} 之间的整数`;
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        st.localVars[X_KEY] = Number(params.option);
      },
    ),
  );

  // ── 额外出杀提供者:返回本回合奇谋加成(回合结束随 turn.vars 清零)──
  unloaders.push(
    registerSlashExtraProvider(state, ownerId, (st, player) => {
      if (player !== ownerId) return 0;
      const bonus = st.turn.vars[EXTRA_KEY];
      return typeof bonus === 'number' ? bonus : 0;
    }),
  );

  // ── 回合结束:还原距离修正(不读 turn.vars——after-hook 在 apply 清空之后触发)──
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx) => {
      const atom = ctx.atom as { type: string; player?: number };
      if (atom.type !== '回合结束') return;
      if (atom.player !== ownerId) return;
      const me = ctx.state.players[ownerId];
      if (!me) return;
      const x = me.vars[BOOST_KEY];
      if (typeof x !== 'number') return;
      const restored = (getDistanceAttackMod(me.vars) ?? 0) - x;
      if (restored > 0) me.vars[ATTACK_KEY] = restored;
      else delete me.vars[ATTACK_KEY];
      delete me.vars[BOOST_KEY];
      if (me.marks.some((m) => m.id === BOOST_MARK_ID)) {
        await applyAtom(ctx.state, {
          type: '去标记',
          player: ownerId,
          markId: BOOST_MARK_ID,
          distanceVars: { attackMod: restored > 0 ? restored : undefined },
        });
      }
    }),
  );

  return () => {
    for (const u of unloaders) u();
    // 卸载兜底:增益未随回合结束还原时(异常路径),直接清 vars/mark
    // (无 view 同步——技能卸载触发 view 重建,同界义从卸载清理)
    const me = state.players[ownerId];
    if (me) {
      const x = me.vars[BOOST_KEY];
      if (typeof x === 'number') {
        const restored = (getDistanceAttackMod(me.vars) ?? 0) - x;
        if (restored > 0) me.vars[ATTACK_KEY] = restored;
        else delete me.vars[ATTACK_KEY];
        delete me.vars[BOOST_KEY];
      }
      me.marks = me.marks.filter((m) => m.id !== BOOST_MARK_ID);
    }
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '奇谋',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动奇谋?(限定技)',
      description:
        '出牌阶段:失去任意点体力并摸等量的牌,本回合你计算与其他角色的距离-X且使用【杀】的限制次数+X',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => defaultPlayActive(ctx),
  });
  // respond:选 X。前端按 pending 自带的 chooseOption options 渲染按钮(同化身)。
  api.defineAction('respond', {
    label: '选择体力值',
    style: 'default',
    prompt: { type: 'confirm', title: '奇谋:选择失去的体力值' },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
