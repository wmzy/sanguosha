// 枭姬(孙尚香·被动技):
//   当你失去一张装备区的牌时,你可以摸两张牌。
//
// 规则要点(描述备注):
//   - 触发时机:失去装备区的牌(任何栏位:武器/防具/进攻马/防御马/宝物)。
//   - 失去方式包括:被拆(过河拆桥→弃置)、被顺(顺手牵羊→获得)、自己替换(装备通用→卸下)等。
//   - "可以"= 可选:每次失去装备后询问是否发动,确认则摸 2 张。
//   - 每失去一张装备牌触发一次(无次数限制)。
//
// 装备流失的三条路径(引擎现状:移动牌 atom 不支持 from 装备区,故装备必经以下三 atom 离开装备栏):
//   1. 卸下(装备通用替换):卸下 atom,player===自己,slot 给定 → 装备→手牌(再移动牌入弃牌堆)。
//      after hook 直接判定:atom.player===ownerId 即失去 1 件装备。
//   2. 弃置(过河拆桥拆装备):弃置 atom,cardIds 含装备牌 → 装备→弃牌堆。
//      after hook 时 apply 已执行,装备已移除,无法事后判断哪些 cardIds 原在装备区。
//      故用 before hook 在 apply 前快照被弃装备牌数,after hook 读取并触发。
//   3. 获得(顺手牵羊顺装备):获得 atom,from===自己,cardId 来自装备区 → 装备→他人手牌。
//      同理用 before hook 快照(after 时已无法判断来自手牌还是装备)。
import type { FrontendAPI, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '枭姬',
    description: '失去装备区的牌时,你可以摸两张牌',
  };
}

/** 询问是否发动枭姬,确认则摸 2 张牌(每失去一件装备触发一次)。
 *  count = 本次 atom 造成的装备流失件数。 */
async function triggerXiaoji(state: GameState, ownerId: number, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const me = state.players[ownerId];
    if (!me?.alive) return; // 死亡不再触发
    delete state.localVars['枭姬/confirmed'];
    await applyAtom(state, {
      type: '请求回应',
      requestType: '枭姬/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动枭姬?(摸两张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: true,
      timeout: 10,
    });
    if (state.localVars['枭姬/confirmed']) {
      await applyAtom(state, { type: '摸牌', player: ownerId, count: 2 });
    }
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:玩家回应"是否发动枭姬"询问,设 localVars 标记结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是枭姬窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '枭姬/confirm') return '当前不是枭姬窗口';
      return null;
    },
    async (state, params) => {
      state.localVars['枭姬/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 路径 1:卸下(替换装备) ──
  registerAfterHook(state, skill.id, ownerId, '卸下', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    await triggerXiaoji(ctx.state, ownerId, 1);
  });

  // ── 路径 2:弃置(过河拆桥拆装备 / 其他弃置装备) ──
  // before 快照:apply 前记录被弃的装备牌件数
  registerBeforeHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    const myEquip = new Set(
      Object.values(ctx.state.players[ownerId].equipment).filter((id): id is string => typeof id === 'string'),
    );
    const lost = (atom.cardIds ?? []).filter((id) => myEquip.has(id)).length;
    if (lost > 0) {
      ctx.state.localVars['枭姬/弃置loss'] = lost;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    const count = ctx.state.localVars['枭姬/弃置loss'] as number | undefined;
    if (!count) return;
    delete ctx.state.localVars['枭姬/弃置loss'];
    await triggerXiaoji(ctx.state, ownerId, count);
  });

  // ── 路径 3:获得(顺手牵羊顺装备 / 其他获得装备) ──
  // before 快照:apply 前判断 cardId 是否来自我的装备区
  registerBeforeHook(state, skill.id, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from !== ownerId) return;
    const myEquip = new Set(
      Object.values(ctx.state.players[ownerId].equipment).filter((id): id is string => typeof id === 'string'),
    );
    if (atom.cardId && myEquip.has(atom.cardId)) {
      ctx.state.localVars['枭姬/获得loss'] = 1;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from !== ownerId) return;
    const count = ctx.state.localVars['枭姬/获得loss'] as number | undefined;
    if (!count) return;
    delete ctx.state.localVars['枭姬/获得loss'];
    await triggerXiaoji(ctx.state, ownerId, count);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '枭姬',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动枭姬？(摸两张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
