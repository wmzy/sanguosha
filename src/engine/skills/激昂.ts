// 激昂(孙策·被动技):每当你使用(指定目标后)或被使用(成为目标后)
//   一张【决斗】或红色的【杀】时,你可以摸一张牌。
//
// 模式 A(被动触发):after hook 挂在「成为目标」。
//   杀 的结算流程:声明阶段逐个 指定目标 → 结算阶段逐个 成为目标。
//   决斗(及离间)的结算在 runUseFlow virtual 模式中也发 成为目标(source=发起者,target=目标)。
//   因此挂「成为目标」after-hook 一处即可覆盖全部 4 种情形:
//     - 孙策使用红杀(atom.source===ownerId)
//     - 孙策被使用红杀(atom.target===ownerId)
//     - 孙策使用决斗(atom.source===ownerId,帧为决斗/离间)
//     - 孙策被使用决斗(atom.target===ownerId,帧为决斗/离间)
//
// 关键点:
//   - 红色杀:card.color==='红'(♥/♦),含转化后的红杀(武圣红牌当杀保留原色)
//   - 决斗判定:实卡 card.name==='决斗';离间等无实体牌的虚拟决斗用 topFrame.skillId
//     ∈ {'决斗','离间'} 兜底
//   - "一张杀"语义:孙策作为使用者时,多目标杀(方天画戟/天义)只触发一次,
//     故对 source 情形按 cardId 去重(localVars 标记);target 情形孙策只是单一目标,天然一次
//   - "可以摸一张牌":可选,询问 confirm;不发动则不摸
//   - 无次数限制(FAQ 明确)
//
// 本文件同时导出 registerJiangFirstStage 工厂(激昂族第一段「成为目标」hook 共享注册,
// 含 isJiangTrigger 谓词),界激昂 复用之,仅注入键命名空间前缀(镜像 鬼道/八卦阵/闭月)。
import type {
  FrontendAPI,
  GameState,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { topFrame } from '../core/frame';
import { registerAfterHook } from '../core/skill';
import { askConfirm, registerConfirmRespond } from '../util/skillRuntime';

const CONFIRM_RT = '激昂/confirm';
const CONFIRMED_KEY = '激昂/confirmed';

/** 判定是否为激昂可触发场景(决斗或红色杀);标/界激昂共用。
 *  allowVirtualFallback:仅「成为目标」hook 需要——虚拟决斗(离间)无实体牌,
 *    靠 topFrame.skillId 兜底。「弃置」hook 处理的必是真实弃牌,应按牌本身身份判定,
 *    不可用帧兜底(否则离间弃置非决斗/红杀的代价牌时会误判为触发)。 */
export function isJiangTrigger(
  state: GameState,
  cardId: string | undefined,
  allowVirtualFallback = true,
): boolean {
  const card = cardId ? state.cardMap[cardId] : undefined;
  if (card?.name === '决斗') return true;
  if (card?.name === '杀' && card.color === '红') return true;
  // 虚拟决斗(离间无实体牌):用当前结算帧兜底
  if (!allowVirtualFallback) return false;
  const frameSkill = topFrame(state)?.skillId;
  if (frameSkill === '决斗' || frameSkill === '离间') return true;
  return false;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激昂',
    description: '使用或被使用【决斗】或红色【杀】时,你可以摸一张牌',
  };
}

/** 激昂族第一段(使用/被使用 决斗或红杀 → 询问摸一张牌)差异参数 */
export interface JiangFirstStageOptions {
  /** requestType/localVars 键前缀(标 '激昂' / 界 '界激昂'):
   *  confirm 询问键 / confirmed 结果键 / source 去重键均由工厂派生,标/界键隔离 */
  keyPrefix: string;
}

/**
 * 注册激昂族第一段:「成为目标」after-hook(覆盖使用/被使用全部四种情形),
 * 含 source 情形 cardId 去重、confirm 询问、摸一张牌。标激昂与界激昂此段逐字同构,
 * 仅键命名空间不同;界激昂 复用本工厂并另行注册自己的第二段(弃置回收)。
 * 返回取消注册函数(调用方按需并入 onInit unload)。
 */
export function registerJiangFirstStage(
  skillId: string,
  state: GameState,
  ownerId: number,
  opts: JiangFirstStageOptions,
): () => void {
  const confirmRt = `${opts.keyPrefix}/confirm`;
  const confirmedKey = `${opts.keyPrefix}/confirmed`;
  /** source 情形去重:已为本 cardId 触发过(localVars 标记,键含 cardId) */
  const srcDoneKey = (cardId: string): string => `${opts.keyPrefix}/src/${cardId}`;

  return registerAfterHook(state, skillId, ownerId, '成为目标', async (ctx): Promise<void> => {
    const atom = ctx.atom;
    const involved = atom.source === ownerId || atom.target === ownerId;
    if (!involved) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (!isJiangTrigger(ctx.state, atom.cardId)) return;

    // source 情形去重:多目标杀只触发一次
    if (atom.source === ownerId) {
      const cardId = atom.cardId ?? '__virtual__';
      const key = srcDoneKey(cardId);
      if (ctx.state.localVars[key]) return;
      ctx.state.localVars[key] = true;
    }

    // 询问是否发动(可选)
    const confirmed = await askConfirm(ctx.state, confirmRt, ownerId, {
      confirmedKey,
      title: '是否发动激昂?(摸一张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 15,
    });
    if (!confirmed) return;

    // 发动:摸一张牌
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:孙策本人回应是否发动激昂 ──
  registerConfirmRespond(state, skill.id, ownerId, CONFIRM_RT, CONFIRMED_KEY, {
    mismatchError: '当前不是激昂确认',
  });

  // ── 成为目标 after hook:覆盖使用/被使用 全部情形(共享工厂,界激昂复用) ──
  registerJiangFirstStage(skill.id, state, ownerId, { keyPrefix: '激昂' });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '激昂',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动激昂?(摸一张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
