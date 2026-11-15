// 界鞬出(界庞德·群雄·被动技):当你使用【杀】指定目标后,你可以弃置其一张牌,
// 若弃置的牌是:基本牌,其获得此【杀】;非基本牌,其不能抵消此【杀】,
// 你本回合使用【杀】的限制次数+1。
//
// 与标版鞬出(鞬出.ts)的差异(经工厂参数注入):
//   - 标版按"装备/非装备"分类(装备→禁闪,非装备→获得杀)
//   - 界版按"基本/非基本"分类(基本→获得杀,非基本→禁闪 + 本回合出杀次数+1)
//   - 界版新增"非基本→出杀次数+1"效果,故须独立界版文件,不修改标版。
//
// 四段式骨架(指定目标询问/目标自选弃牌/成为目标 cancel/移动牌延迟拿取/询问闪 cancel)、
// 全座次 respond 复用标版鞬出导出的 createJianchuSkill 工厂;键前缀换为 '界鞬出/'。
//
// 出杀次数+1 实现策略:用 registerSlashExtraProvider 注册一个 provider,返回值 =
//   state.turn.vars['界鞬出/quotaBonus'](number,本回合内累计的非基本牌加成次数)。
//   回合结束 turn.vars 自动清空 → 加成自动失效,符合"本回合"语义。
//   杀.execute 末尾仍调用 incSlashUsed(已用次数 +1,优先扣额定),配合
//   slashMax = 额定(quota)+ 额外(extra),自然得到"剩余次数 = 上限 - 已用"。
//
// 目标自选弃牌:官方 FAQ 与标版鞬出同理——目标决定弃基本牌(此杀不命中且目标获得杀)
//   还是非基本牌(强制命中且本回合+1 杀次数)。界庞德仅决定是否发动。
import type { GameState } from '../types';
import { createJianchuSkill, type JianchuOptions } from './鞬出';
import { registerSlashExtraProvider, projectSlashExtra } from '../rules/slash-quota';

const TAG = '界鞬出/禁闪';
const CONFIRM = '界鞬出/confirmed';
const PICK = '界鞬出/选牌'; // 选牌询问的 requestType
/** target→杀cardId 映射:目标选了基本牌,应"获得此杀"(成为目标 + 移动牌 hook 消费) */
const GAIN = '界鞬出/获得杀';
/** 本回合出杀次数加成(number):每发动一次"非基本→禁闪"则 +1。回合结束随 turn.vars 清空。 */
const QUOTA_BONUS = '界鞬出/quotaBonus';

const OPTIONS: JianchuOptions = {
  description:
    '使用杀指定目标后,可弃其一张牌:基本牌则其获得此杀;非基本牌则其不能抵消此杀且本回合出杀次数+1',
  tag: TAG,
  confirmRt: '界鞬出/confirm',
  confirmedKey: CONFIRM,
  pickRt: PICK,
  pickTitle:
    '界鞬出:选择弃置的一张牌(基本牌→获得此杀;非基本牌→不能抵消且对方本回合出杀+1)',
  gainKey: GAIN,
  respondFallbackError: '当前不是界鞬出回应',
  classify: (card) => (card?.type === '基本牌' ? 'gain' : 'block'),
  // 非基本牌(装备/锦囊):本回合出杀次数+1
  onBlock: async (state, ownerId, _target) => {
    const cur = (state.turn.vars[QUOTA_BONUS] as number | undefined) ?? 0;
    state.turn.vars[QUOTA_BONUS] = cur + 1;
    // 额外出杀次数须投影到 view:前端 viewSlashMax/无头枚举读 view.turnUsage['杀/extra/*'],
    // 缺失则 +1 后第 2 张杀在客户端不可用(引擎放行但发不出动作)。
    await projectSlashExtra(state, ownerId, '界鞬出', cur + 1);
  },
  mountTitle: '鞬出:是否弃置目标一张牌?',
  // ── 额外出杀提供者:返回本回合已累计的"非基本→+1"加成次数(叠加型) ──
  // 与 registerAction/registerBeforeHook 同构:state-bound 注册,随 unload 清理。
  // 加成值存于 turn.vars,回合结束自动清零(天然满足"本回合"语义)。
  extraInit: (state: GameState, ownerId: number) =>
    registerSlashExtraProvider(state, ownerId, (st, player) => {
      if (player !== ownerId) return 0;
      const bonus = st.turn.vars[QUOTA_BONUS];
      return typeof bonus === 'number' ? bonus : 0;
    }),
};

export const { createSkill, onInit, onMount } = createJianchuSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
