// 界固政(界张昭张纮·吴·被动技·OL 界限突破版):
//   每阶段限一次,当其他角色的至少两张牌因弃置而置入弃牌堆后,
//   你可以将其中一张牌交给该角色,然后你可以获得其余的牌。
//
// OL 界限突破差异(相对标 固政 src/engine/skills/固政.ts):
//   1. **触发时机**:从「弃牌阶段结束时(阶段结束 hook)」改为「弃置事件后(弃置 afterHook)」,
//      任意阶段均可触发(出牌阶段制衡弃置 / 弃牌阶段弃牌等)。
//   2. **≥2 张门槛**:仅当本阶段该角色累计因弃置置入弃牌堆的牌 ≥2 张时才询问。
//   3. **每阶段限一次**:同一阶段只触发一次询问窗口(无论发动与否)。
//   4. **「获得其余」可选**:询问是否获得其余弃牌,可选择不获得(标版为必得)。
//
// 实现机制:
//   1. 弃置 afterHook:其他角色(player≠ownerId)弃置时,累加 cardIds 到 localVars(按玩家分桶)。
//      若本阶段尚未触发过 且 累计 ≥2 张 且 自己存活 → 进入发动流程,并立即置位「本阶段已触发」。
//   2. 发动流程(确认 → 选一张交给该角色 → 询问获其余)复用标版固政导出的
//      runGuzhengFlow(差异经 restMode:'ask' 注入;询问 requestType/localVars 键按
//      '界固政/…' 前缀隔离,与标版互不串扰)。
//   3. 阶段结束 afterHook:清空本技能所有 localVars(累加桶 + 已触发标记),为下一阶段重置。
//   4. respond action:处理三步回应(按当前 pending requestType 分支)。
//
// 关键点 / 裁定:
//   - 「每阶段限一次」按「一阶段一询问窗口」实现:累计达 ≥2 张时询问一次,无论发动与否,
//     本阶段不再询问(置位 已触发 标记)。这避免同一阶段多次弃置反复打扰玩家,符合 OL 表现。
//   - 「交给该角色」用 移动牌(弃牌堆→该角色手牌)实现,与标版固政一致。
//   - 仅在仍位于弃牌堆的牌中选取(防御性:理论上不会有牌被中途移走)。
//   - 自己不存活则不触发;目标(弃牌者)死亡仍可正常结算(牌已入弃牌堆)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, registerAfterHook } from '../core/skill';
import { currentRequestType, requireRequestType } from '../util/skillRuntime';
import { runGuzhengFlow } from './固政';
import type { SkillModule } from '../types';

const SKILL_NAME = '界固政';
const CONFIRM_REQUEST = '界固政/确认';
const PICK_REQUEST = '界固政/选牌';
const REST_REQUEST = '界固政/获其余';
const CONFIRM_KEY = '界固政/确认结果';
const PICK_KEY = '界固政/所选牌';
const REST_KEY = '界固政/获其余结果';
/** 本阶段是否已触发过询问窗口(每阶段限一次) */
const TRIGGERED_KEY = '界固政/已触发';

/** localVars key:界固政/弃牌/<player> = 该玩家本阶段累计因弃置置入弃牌堆的 cardIds */
function discardKey(player: number): string {
  return `界固政/弃牌/${player}`;
}

/** 清空本技能所有 localVars(阶段结束时调用,为下一阶段重置) */
function clearPhaseVars(state: GameState): void {
  for (const key of [...Object.keys(state.localVars)]) {
    if (key.startsWith('界固政/')) delete state.localVars[key];
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '每阶段限一次,其他角色≥2张牌因弃置置入弃牌堆后,可将其中一张交给该角色,然后可获其余',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 弃置 afterHook:累计弃牌 + 达门槛时触发 ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player === ownerId) return; // 仅其他角色
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return; // 自己须存活

    // 累计该玩家本阶段弃置的牌
    const key = discardKey(atom.player);
    const existing = st.localVars[key] as string[] | undefined;
    const accumulated = [...(existing ?? []), ...atom.cardIds];
    st.localVars[key] = accumulated;

    // 每阶段限一次:本阶段已触发过则不再询问
    if (st.localVars[TRIGGERED_KEY]) return;
    // ≥2 张门槛
    if (accumulated.length < 2) return;

    // 进入发动流程,立即置位「本阶段已触发」(无论后续发动与否)
    st.localVars[TRIGGERED_KEY] = true;
    const player = atom.player;
    const cardIds = [...accumulated];

    // 发动流程:确认 → 选一张交给该角色 → 询问获得其余(界版可选)
    await runGuzhengFlow(st, ownerId, player, cardIds, {
      skillName: SKILL_NAME,
      confirmRequest: CONFIRM_REQUEST,
      confirmKey: CONFIRM_KEY,
      pickRequest: PICK_REQUEST,
      pickKey: PICK_KEY,
      pickTitle: '界固政:选择一张牌交给该角色(其余你可获得)',
      restMode: 'ask',
      restRequest: REST_REQUEST,
      restKey: REST_KEY,
    });
  });

  // ── 阶段结束 afterHook:清空本阶段 localVars,为下一阶段重置 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    clearPhaseVars(ctx.state);
  });

  // ── respond action:处理 确认 / 选牌 / 获其余 三步回应(按当前 pending requestType 分支)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const check = requireRequestType(
        st,
        ownerId,
        [CONFIRM_REQUEST, PICK_REQUEST, REST_REQUEST],
        {
          wrongTypeError: '当前不是界固政窗口',
          mismatchError: '当前不是界固政窗口',
        },
      );
      if (check.error) return check.error;
      const rt = check.requestType;
      if (rt === CONFIRM_REQUEST || rt === REST_REQUEST) {
        // 确认/不确认都接受
        return null;
      }
      // PICK_REQUEST:选一张交给该角色
      const cardId = params.cardId;
      if (typeof cardId !== 'string') return '需要选择一张牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_REQUEST) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_REQUEST) {
        st.localVars[PICK_KEY] = params.cardId;
      } else if (rt === REST_REQUEST) {
        st.localVars[REST_KEY] = params.choice === true || params.confirmed === true;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 界固政为被动技,无主动 action 按钮需要声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
