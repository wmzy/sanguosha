// 护驾(曹操·主公技):当你需要使用或打出一张【闪】时,你可以令其他魏势力角色
//   选择是否打出一张【闪】(视为由你使用或打出)。
//
// 模式 B(主动技变体):注册 respond action 在曹操座次。
//   当前 pending 是询问闪 + target=曹操 → 护驾.respond → 逐个询问魏势力角色出闪
//
// 流程:
//   1. 曹操被询问闪(询问闪 atom,pending slot target=曹操)
//   2. 曹操 dispatch 护驾.respond(dispatch 找到询问闪 slot,pause 它)
//   3. 护驾.respond execute:
//      a. 按座次顺序逐个询问其他魏势力角色是否打出闪(请求回应)
//      b. 第一个出闪的角色:移闪到处理区(视为曹操打出)
//      c. 全部拒绝:处理区无闪(曹操承受伤害)
//   4. execute 完成 → dispatch 自动 resolve 询问闪 slot → 杀结算检查处理区
//
// 关键点:
//   - execute 完成后 dispatch 自动 resolve 询问闪 slot(无需手动 resolve)
//   - 嵌套请求回应创建的 pending slot(魏势力角色),与询问闪 slot 不同 target,不冲突
//   - 魏势力角色出闪后,闪移入处理区;杀结算流程检查处理区有无闪
//   - 主公技限制:曹操恒为主公(ownerId=0),无需额外 isLord 校验
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../index';
import { registerAction, declareAlternativeResponse } from '../core/skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '护驾',
    description: '主公技:需要闪时,令其他魏势力角色替你打出闪',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 护驾.respond:曹操在询问闪时选择护驾 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
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
        delete st.localVars['护驾/闪出'];
        await applyAtom(st, {
          type: '请求回应',
          requestType: '护驾/出闪',
          target: allyIdx,
          prompt: {
            type: 'useCard',
            title: `护驾:曹操(${st.players[ownerId]?.name ?? `P${ownerId}`})需要闪,是否打出一张闪?`,
            cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
          },
          timeout: 15,
        });

        const dodgeCardId = st.localVars['护驾/闪出'] as string | undefined;
        delete st.localVars['护驾/闪出'];

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
  );

  // ── 为所有魏势力角色注册 respond(回应护驾出闪询问)──
  // 默认 respond 只注册在 owner(曹操)上,魏势力角色无法 dispatch。
  // 此处为每个魏势力角色注册 respond,validate 严格检查 pending requestType。
  for (const p of state.players) {
    const pid = p.index;
    if (pid === ownerId) continue;
    if (p.faction !== '魏') continue;

    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        if (atom['requestType'] !== '护驾/出闪') return '当前不是护驾询问';
        const cardId = params.cardId as string | undefined;
        if (cardId) {
          if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
          if (st.cardMap[cardId]?.name !== '闪') return '只能打出闪';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const cardId = params.cardId as string | undefined;
        if (cardId) {
          st.localVars['护驾/闪出'] = cardId;
        }
        // cardId 为空 = 不出闪(拒绝护驾)
      },
    );
  }

  const unloadDecl = declareAlternativeResponse(state, ownerId, '询问闪');
  return () => { unloadDecl(); };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 护驾 respond:单注册,按 pending 内容分支(镜像 激将 的单 respond 模式)。
  //   - 曹操被询问闪(atom.type==='询问闪',target=曹操):confirm 发动护驾
  //   - 魏势力角色收到 护驾/出闪 询问(requestType==='护驾/出闪'):出闪
  // 注:前端 skillActionRegistry 以 `${skillId}:${ownerId}:${actionType}` 为键、
  //   用 Map.set 覆盖;同 key 的第二次 defineAction 会覆盖第一次。故两条 respond
  //   必须合并为一条,否则曹操的护驾按钮会被魏角色定义覆盖而无法发动护驾。
  //   魏角色的出闪卡牌筛选由 pending 的 candidates(投影层注入)驱动,不依赖本 action。
  api.defineAction('respond', {
    label: '护驾',
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
      if (slot.target !== ctx.perspectiveIdx) return false;
      const atom = slot.atom as { type: string; requestType?: string };
      // 曹操被询问闪 → 发动护驾(confirm)
      if (atom.type === '询问闪') return true;
      // 魏势力角色收到护驾/出闪询问 → 出闪(卡牌选择由 pending 驱动)
      if (atom.type === '请求回应' && atom.requestType === '护驾/出闪') return true;
      // 势力检查由后端 validate 处理(GameView 不暴露 faction)
      return false;
    },
  });

  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
