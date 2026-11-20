// 界乱击(界袁绍·群·转化技,OL 界限突破官方逐字):
//   你可以将两张花色相同的手牌当【万箭齐发】使用。你使用【万箭齐发】可以少选一个目标。
//
// 与标版乱击( src/engine/skills/乱击.ts )区别:
//   - 转化部分(两张同花色手牌 → 万箭齐发):与标版完全一致(工厂同参,仅影子后缀为 '界乱击')。
//   - 新增:"你使用【万箭齐发】可以少选一个目标"——界袁绍座次使用任何来源的
//     【万箭齐发】(界乱击转化或实际万箭齐发牌)时,均可选择至多 1 名目标排除。
//     为角色锁定属性,故必须独立界版文件,镜像 界火计/界连环 的覆盖模式。
//
// 模型(组合 action + 覆盖):
//   ① transform action(preceding,界乱击.transform):两张同花色手牌 → 影子"万箭齐发"
//      (skillRuntime 转化技工厂统一实现,cardCount=2 维度)。
//      前端组合:preceding=[界乱击.transform cardIds=[id1,id2]] + 主 action=万箭齐发.use
//      (cardId = `${id1}#${id2}#界乱击`,影子卡,后缀 = 技能 id 与客户端构造约定一致)。
//   ② use action(覆盖万箭齐发.use,仅本座次):界版万箭齐发结算,主流程开始前
//      插入"少选一个目标"询问(choosePlayer min:0,max:1)。覆盖保证:
//      - 界袁绍以任何来源的【万箭齐发】均走界版结算。
//      - 其他座次的万箭齐发仍走标版(由标版万箭齐发 card skill 注册)。
//
// 覆盖机制:万箭齐发在 DEFAULT_SKILLS 中先实例化标版万箭齐发.use;界乱击.onInit 后实例化,
//   registerAction('万箭齐发', ownerId, 'use', ...) 覆盖标版注册(state-bound 注册表 Map.set 覆盖)。
//   "你使用【万箭齐发】可以少选一个目标" 为角色锁定属性,凡本座次使用万箭齐发均走界版,
//   符合官方语义。镜像 界火计.ts / 界连环.ts 的覆盖模式。
//
// "少选一个目标"语义(OL 官方 FAQ):
//   - 默认目标:除使用者外所有存活角色(标版万箭齐发自动选定)。
//   - 界版允许使用者从中至多排除 1 名(可选 0 或 1 名)。
//   - 排除后剩余目标可为 0(此时万箭齐发无目标但仍按锦囊正常进处理区→弃牌堆,
//     走完无懈可询问流程)。
//
// 原牌归宿(与标版一致):2 张原卡从手牌移除、合并成影子卡;影子卡离开结算区进弃牌堆时,
//   因 shadowOf 为空(多卡转化无一一对应原卡),引擎不自动还原——原卡停留在
//   cardMap 但已不在任何手牌区(与丈八蛇矛一致)。rollback 删影子(工厂统一实现;
//   手牌原卡还原由 dispatch 快照整体还原,core/rollback.ts)。
//   乱击出的万箭齐发可被无懈可击抵消——由 万箭齐发.use 自身的 询问无懈可击 流程保证。
//
// 命名:文件名/loader key/character skill name 均为 '界乱击'(避开标乱击冲突);
//   内部 Skill.name = '乱击'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { registerAction } from '../core/skill';
import { runUseFlow, chargeOnSettle } from './cards/use-card';
import { askResponse, requireRequestType, registerTransformAction, mountTransformAction, engineCanPlayNowReason, firstTarget, type TransformActionOptions } from '../util/skillRuntime';
import { alivePlayersClockwiseFrom } from '../util/player-query';
import { OPTIONS } from './乱击';

const SKILL_ID = '界乱击';
const DISPLAY_NAME = '乱击';
/** "少选一个目标"请求回应的 requestType(路由到本技能 respond) */
const SKIP_TARGET_RT = `${SKILL_ID}/skipTarget`;
/** localVars key:玩家选择的排除目标座次(number | undefined | null) */
const SKIP_TARGET_KEY = `${SKILL_ID}/skipTargetChoice`;

// 转化部分与标版完全一致:spread 乱击.ts 的共享 OPTIONS(cardPredicate/comboFilter/
// activeWhen 同花色扫描/targetFilter 逐字共用),仅覆盖界版文案差异(invalidError/
// prompt.title)。影子后缀 `${id1}#${id2}#界乱击` 由注册时的 skill.id 决定,与标版天然隔离。
const TRANSFORM_OPTIONS: TransformActionOptions = {
  ...OPTIONS,
  invalidError: '界乱击需要两张同花色的手牌',
  mount: {
    ...OPTIONS.mount,
    prompt: {
      ...OPTIONS.mount.prompt,
      title: '选择 2 张同花色的手牌当万箭齐发使用(界版:可少选一个目标)',
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '你可以将两张花色相同的手牌当【万箭齐发】使用;你使用【万箭齐发】可以少选一个目标',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:两张同花色手牌 → 影子"万箭齐发"(作为 preceding) ───
  registerTransformAction(state, skill.id, ownerId, TRANSFORM_OPTIONS);

  // ─── use action:覆盖标版万箭齐发.use,本座次走界版结算(可少选 1 目标) ───
  // 万箭齐发在 DEFAULT_SKILLS 中先实例化标版;此处 registerAction 覆盖之(同 key 覆盖)。
  // 仅影响本座次(界袁绍),其他座次的万箭齐发仍走标版。
  registerAction(
    state,
    '万箭齐发',
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 校验同标版万箭齐发.use:自己回合 + 出牌阶段 + 无阻塞 pending + 存活 +
      // 手牌中存在万箭齐发(含影子卡)。万箭齐发本无目标参数(targets 由本流程自动计算)。
      const playError = engineCanPlayNowReason(state, ownerId);
      if (playError) return playError;
      const self = state.players[ownerId];
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return 'cardId required';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (state.cardMap[cardId]?.name !== '万箭齐发') return '不是万箭齐发';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;

      // 计算默认目标:除使用者外所有存活角色,从下家起逆时针
      // (from 为使用者必存活;fromPos<0 的升序兜底分支实际不可达)
      const defaultTargets = alivePlayersClockwiseFrom(state, from, { includeSelf: false });

      // ── "少选一个目标"询问(界版核心):从默认目标中可选排除至多 1 名 ──
      // 仅当默认目标 ≥ 1 时才有意义询问(0 个目标时万箭齐发无效果,但仍走流程)
      let targets = defaultTargets;
      if (defaultTargets.length >= 1) {
        // prompt 带 description(可放弃说明),askChooseTarget 不支持该字段,走 askResponse。
        const skipTarget = await askResponse<number>(state, SKIP_TARGET_RT, from, {
          prompt: {
            // choosePlayer(非 selectTarget):服务端驱动的 pending 目标选择只有
            // choosePlayer 被投影层(resolveChoosePlayerCandidates)、前端 AwaitingPrompt
            // 和 headless appendRespondActions 支持。selectTarget 仅用于前端 bundle 内的
            // 主动 use action(filter 函数无法跨进程序列化,pending 下发后前端拿不到)。
            type: 'choosePlayer',
            title: '界乱击:可少选一个目标(选 0 或 1 名排除)',
            description: '可放弃(不排除任何目标)',
            min: 0,
            max: 1,
            filter: (_view, t) => defaultTargets.includes(t),
          },
          timeout: 20,
          resultKey: SKIP_TARGET_KEY,
        });
        if (typeof skipTarget === 'number') {
          targets = defaultTargets.filter((t) => t !== skipTarget);
        }
      }

      // 走标准万箭齐发使用结算流程(runUseFlow):保留全部声明阶段与结算阶段时机 atom
      // (指定目标→成为目标→成为目标后→检测有效性→生效前→无懈→生效时→生效后→
      //   询问闪+伤害→使用结算结束时)及其 before/after hook,与标版万箭齐发.use 完全一致。
      // 与标版唯一差异:targets 已预先排除"少选"的 1 名。
      // (此前手写逐目标循环漏掉了 检测有效性/成为目标/生效前 等 atom,导致空城/谦逊等
      //   "不能成为目标"锁定技对界袁绍的万箭齐发失效。)
      await runUseFlow(state, from, cardId, targets, '万箭齐发', {
        onSettle: chargeOnSettle(state, from, cardId),
      });
    },
  );

  // ─── respond action:处理"少选一个目标"询问 ──────────────
  // requestType='界乱击/skipTarget' 路由到本技能。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const check = requireRequestType(state, ownerId, [SKIP_TARGET_RT], {
        wrongTypeError: '当前不是界乱击询问',
        mismatchError: '当前不是界乱击询问',
      });
      if (check.error) return check.error;
      // choosePlayer 契约:单选发 {target,targets:[t]};「不选择」发 {targets:[]}。
      // 未选(undefined/null)=不排除;选了 = 座次号(firstTarget 两形状归一读取)
      const target = firstTarget(params);
      if (target === undefined) return null;
      if (!state.players[target]?.alive) return '目标不存在或已死亡';
      // target 必须在候选目标中(由 prompt.filter 限制,后端兜底)
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const target = firstTarget(params);
      state.localVars[SKIP_TARGET_KEY] = target ?? null;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  // 前端:界乱击是多卡转化技(同标版乱击)。transform 把选中两张同花色手牌包装成 CardWrapper。
  // 前端通过 prompt.cardFilter.min/max (2..2) 识别多卡选牌,进入多选转化模式,
  // 提交 preceding params.cardIds=[id1,id2]。主 action skillId 由 transform.name='万箭齐发' 决定,
  // 后端万箭齐发.use 已被本座次界版覆盖(增加"少选一个目标"询问)。
  mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);
  // respond action:"少选一个目标" choosePlayer 询问
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'choosePlayer',
      title: '界乱击:少选一个目标(可选)',
      min: 0,
      max: 1,
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
