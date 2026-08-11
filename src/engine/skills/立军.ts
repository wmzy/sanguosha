// 立军(孙亮·吴·主公技,风林火山 hero/403):
//   "主公技,其他吴势力角色出牌阶段限一次,当其使用【杀】后,
//    其可以令你获得之,然后你可以令其摸一张牌且此回合使用【杀】的限制次数+1。"
//
// 机制(主公技,孙亮实例注册):
//   1) 使用结算结束后 afterHook:其他吴势力角色(非自己)用杀结算后,
//      询问其是否把此杀交给孙亮(主公)。
//      - 是:移动牌(弃牌堆→孙亮手牌) + 标记本回合已用(turn.vars)。
//        再询问孙亮是否令其摸牌+杀次+1。
//        - 是:其摸 1 张 + 设 turn.vars['立军/quota/<ally>']=true。
//   2) SlashExtraProvider(为每个吴盟友注册):读 turn.vars 标志,返回 +1 出杀上限。
//
// 关键点:
//   - 主公技:仅孙亮为主公(ownerId===0)时生效(参考激将/救援/若愚的主公判定)。
//   - "其他吴势力角色":source!==ownerId && faction==='吴'。
//   - "出牌阶段限一次":turn.vars['立军/used/<ally>'] 标记(回合结束自动清空)。
//   - 杀卡位置:使用结算结束后已移入弃牌堆(runUseFlow 在发本 atom 前完成牌移动),
//     移动牌(弃牌堆→手牌);防御性检查卡仍在弃牌堆。
//   - +1 杀次通过 SlashExtraProvider(slash-quota 通用机制),不自造标签。
//   - 双询问:先问盟友(给牌 confirm),再问主公(摸牌+杀次 confirm),各自独立。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import type { SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, registerAfterHook } from '../core/skill';
import { registerSlashExtraProvider } from '../rules/slash-quota';

const ALLY_CONFIRM_RT = '立军/盟友确认'; // 问盟友:是否把杀交给主公
const LORD_CONFIRM_RT = '立军/主公确认'; // 问主公:是否令其摸牌+杀次+1
const ALLY_CONFIRM_KEY = '立军/盟友确认结果';
const LORD_CONFIRM_KEY = '立军/主公确认结果';

/** turn.vars key:本回合该盟友是否已用过立军(限一次) */
function usedKey(ally: number): string {
  return `立军/used/${ally}`;
}
/** turn.vars key:本回合该盟友是否已获 +1 杀次 */
function quotaKey(ally: number): string {
  return `立军/quota/${ally}`;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '立军',
    description:
      '主公技:其他吴势力角色用杀后可交给你获得,你可令其摸一张牌且本回合使用杀的限制次数+1',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloads: Array<() => void> = [];

  // ── 为每个吴势力盟友注册 SlashExtraProvider(读 turn.vars 决定 +1) ──
  for (const p of state.players) {
    if (p.index === ownerId) continue;
    if (p.faction !== '吴') continue;
    const allyIdx = p.index;
    const u = registerSlashExtraProvider(state, allyIdx, (st) =>
      st.turn.vars[quotaKey(allyIdx)] === true ? 1 : 0,
    );
    unloads.push(u);
  }

  // ── 使用结算结束后 afterHook:其他吴角色用杀后触发 ──
  unloads.push(
    registerAfterHook(state, skill.id, ownerId, '使用结算结束后', async (ctx) => {
      const atom = ctx.atom;
      const st = ctx.state;
      // 主公技:仅孙亮为主公(座次 0)时生效
      if (ownerId !== 0) return;
      const card = st.cardMap[atom.cardId];
      if (!card || card.name !== '杀') return;
      const source = atom.source;
      // 其他角色(非自己)
      if (source === ownerId) return;
      // 须为盟友的出牌阶段(自己回合)
      if (st.currentPlayerIndex !== source) return;
      const ally = st.players[source];
      if (!ally?.alive) return;
      if (ally.faction !== '吴') return;
      const lord = st.players[ownerId];
      if (!lord?.alive) return;
      // 出牌阶段限一次
      if (st.turn.vars[usedKey(source)] === true) return;

      // 标记本回合已用(触发即消耗一次机会,无论盟友是否交牌)
      st.turn.vars[usedKey(source)] = true;

      await pushFrame(st, '立军', ownerId, { ally: source, cardId: atom.cardId });

      // ── 第一步:问盟友是否把此杀交给主公 ──
      delete st.localVars[ALLY_CONFIRM_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: ALLY_CONFIRM_RT,
        target: source,
        prompt: {
          type: 'confirm',
          title: `立军:是否将此【杀】交给 ${lord.name ?? '主公'}?`,
          confirmLabel: '交给主公',
          cancelLabel: '不交',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const allyYes = st.localVars[ALLY_CONFIRM_KEY] === true;
      delete st.localVars[ALLY_CONFIRM_KEY];
      if (!allyYes) {
        await popFrame(st);
        return;
      }

      // 标记已在触发时设(见上方 usedKey 赋值)

      // 移动杀卡:弃牌堆 → 主公手牌(防御性:卡仍在弃牌堆才移动)
      if (st.zones.discardPile.includes(atom.cardId)) {
        await applyAtom(st, {
          type: '移动牌',
          cardId: atom.cardId,
          from: { zone: '弃牌堆' },
          to: { zone: '手牌', player: ownerId },
        });
      }

      // ── 第二步:问主公是否令其摸牌+杀次+1 ──
      delete st.localVars[LORD_CONFIRM_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: LORD_CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `立军:是否令 ${ally.name ?? '该角色'} 摸一张牌且本回合使用杀的限制次数+1?`,
          confirmLabel: '令其摸牌+杀次+1',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const lordYes = st.localVars[LORD_CONFIRM_KEY] === true;
      delete st.localVars[LORD_CONFIRM_KEY];
      if (!lordYes) {
        await popFrame(st);
        return;
      }

      // 盟友摸 1 张 + 杀次 +1(turn.vars 标志,SlashExtraProvider 读取)
      if (st.players[source]?.alive) {
        await applyAtom(st, { type: '摸牌', player: source, count: 1 });
      }
      st.turn.vars[quotaKey(source)] = true;

      await popFrame(st);
    }),
  );

  // ── respond action:为所有玩家注册(盟友 + 主公都可能被问) ──
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, _params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        if (slot.atom.type !== '请求回应') return '当前不是立军窗口';
        const rt = (slot.atom as { requestType?: string }).requestType;
        if (rt !== ALLY_CONFIRM_RT && rt !== LORD_CONFIRM_RT) return '当前不是立军窗口';
        return null; // confirm:确认/取消都接受
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId)!;
        const rt = (slot.atom as { requestType?: string }).requestType;
        const yes = params.choice === true || params.confirmed === true;
        if (rt === ALLY_CONFIRM_RT) {
          st.localVars[ALLY_CONFIRM_KEY] = yes;
        } else if (rt === LORD_CONFIRM_RT) {
          st.localVars[LORD_CONFIRM_KEY] = yes;
        }
      },
    );
    unloads.push(u);
  }

  return () => {
    for (const u of unloads) u();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
