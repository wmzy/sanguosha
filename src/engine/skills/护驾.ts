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
//      a. 从主公起逆时针逐个询问其他魏势力角色是否打出闪(请求回应)
//      b. 第一个出闪的角色:移闪到处理区(视为曹操打出)
//      c. 全部拒绝:处理区无闪(曹操承受伤害)
//   4. execute 完成 → dispatch 自动 resolve 询问闪 slot → 杀结算检查处理区
//
// 关键点:
//   - execute 完成后 dispatch 自动 resolve 询问闪 slot(无需手动 resolve)
//   - 嵌套请求回应创建的 pending slot(魏势力角色),与询问闪 slot 不同 target,不冲突
//   - 魏势力角色出闪后,闪移入处理区;杀结算流程检查处理区有无闪
//   - 主公技限制:界版校验曹操为主公(ownerId=0);标版历史无此校验(保持)
//
// 本文件同时导出 createHujiaSkill 工厂(护驾族共享实现),界护驾 复用之:
//   标/界共享主技(询问闪 → 逐个询问魏角色代出闪)、跨座次 respond 注册、
//   替代回应声明与 onMount 骨架;差异全部显式注入——键前缀(=各自技能 id)/文案/
//   主公校验/界版新增被动触发(魏角色回合外用闪 → 可令曹操摸1,每回合限一次)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { setTurnVarUsage } from '../rules/turn-usage';
import { registerAction, registerAfterHook, declareAlternativeResponse } from '../core/skill';
import type { SkillModule } from '../types';
import { askConfirm, currentRequestType, defineConfirmAction, requireRequestType } from '../util/skillRuntime';

/** 护驾族差异参数(标/界共享实现,差异全部显式注入)。 */
export interface HujiaOptions {
  /** 技能 id(= 键空间前缀:出闪/drawChoice requestType、闪出/confirmed/triggered vars;标 '护驾' / 界 '界护驾') */
  skillId: string;
  /** 玩家可见技能名(Skill.name + onMount 按钮 label;标 '护驾' / 界 '界护驾') */
  displayName: string;
  description: string;
  /** 主公校验:界版仅曹操为主公(座次 0)时可发动;标版历史无此校验 */
  lordOnly: boolean;
  /** 界版被动触发:其他魏角色回合外使用/打出闪 → 其可令曹操摸1张(每回合限一次) */
  passiveDraw: boolean;
  /** 替代回应声明先于 respond 注册(界版历史次序;声明表与 action 表独立,次序不影响行为) */
  declareAltFirst: boolean;
  /** 卸载时回收全部注册(界版);标版历史仅回收替代回应声明 */
  unloadAll: boolean;
}

/** 护驾族共享实现:标护驾与界护驾的主技(询问闪→魏角色代出闪)逐字一致;
 *  界版追加主公校验与"回合外用闪令曹操摸牌"被动触发。 */
export function createHujiaSkill(opts: HujiaOptions) {
  // 键名遵循 `${SKILL_ID}/…` 局部技能名模板约定。
  const SKILL_ID = opts.skillId;
  /** 出闪询问 requestType */
  const DODGE_RT = `${SKILL_ID}/出闪`;
  /** 出闪结果 localVars 键 */
  const DODGE_PLAYED_VAR = `${SKILL_ID}/闪出`;
  // ── 界版被动触发专用键 ──
  /** "是否令曹操摸牌"询问 requestType */
  const REQUEST_TYPE = `${SKILL_ID}/drawChoice`;
  /** "是否令曹操摸牌"确认结果 localVars 键 */
  const CONFIRMED_VAR = `${SKILL_ID}/confirmed`;
  /** 每回合限一次标记:存 state.turn.vars(回合结束 atom 清空 turn.vars → 自动复位) */
  const PER_TURN_VAR = `${SKILL_ID}/triggered`;

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): (() => void) | void {
    const ownerId = skill.ownerId;
    const offs: Array<() => void> = [];
    let unloadDecl: () => void = () => {};

    if (opts.declareAltFirst) {
      unloadDecl = declareAlternativeResponse(state, ownerId, '询问闪');
      offs.push(unloadDecl);
    }

    // ── 主技 respond:曹操在询问闪时选择护驾 ──
    offs.push(
      registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          // 主公技:界版仅曹操为主公(座次 0)时可用
          if (opts.lordOnly && ownerId !== 0) return '非主公不能发动护驾';
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
          // 从主公起逆时针逐个询问魏势力角色
          const numPlayers = st.players.length;
          for (let offset = 1; offset < numPlayers; offset++) {
            const allyIdx = (ownerId - offset + numPlayers) % numPlayers;
            const ally = st.players[allyIdx];
            if (!ally?.alive) continue;
            if (ally.faction !== '魏') continue;
            if (ally.hand.length === 0) continue;

            // 询问该魏势力角色是否打出闪
            delete st.localVars[DODGE_PLAYED_VAR];
            await applyAtom(st, {
              type: '请求回应',
              requestType: DODGE_RT,
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

    // ── 移动牌 after hook:界版被动触发——魏角色回合外打出闪 → 询问是否令曹操摸1张 ──
    if (opts.passiveDraw) {
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
            if (card?.name !== '闪') return;
            // 必须是该魏角色"回合外"(当前回合不是其本人回合)
            if (ctx.state.currentPlayerIndex === sourceIdx) return;
            // 曹操需存活(否则无人摸牌)
            const lord = ctx.state.players[ownerId];
            if (!lord?.alive) return;
            // 每回合限一次(本回合已触发过则跳过)
            if (ctx.state.turn.vars[PER_TURN_VAR] === true) return;

            // 标记本回合已触发(同步写 turn.vars 防止 hook 重入;turn.vars 由回合结束自动清空)
            await setTurnVarUsage(ctx.state, ownerId, PER_TURN_VAR, true);

            // 询问魏角色是否令曹操摸1张(描述"可以"=可选;选择权在该魏角色)
            const confirmed = await askConfirm(ctx.state, REQUEST_TYPE, sourceIdx, {
              confirmedKey: CONFIRMED_VAR,
              title: `${SKILL_ID}:是否令${lord.name}摸一张牌?`,
              confirmLabel: '令曹操摸牌',
              cancelLabel: '不发动',
              defaultChoice: false,
              timeout: 30,
            });

            if (confirmed) {
              // 魏角色选择发动 → 曹操摸 1 张
              await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
            }
          },
        ),
      );
    }

    // ── 为所有其他魏势力角色注册 respond(回应护驾代出闪;界版兼回应"是否令曹操摸牌")──
    // 默认 respond 只注册在 owner(曹操)上,魏势力角色无法 dispatch。
    // 此处为每个魏势力角色注册 respond,validate 严格检查 pending requestType。
    // 出闪与 drawChoice(界版)共用一个注册键 `${skillId}:${seat}:respond`(后注册覆盖
    // 前注册),不能拆成 registerConfirmRespond——拆分会丢走出闪分支。
    for (const p of state.players) {
      const pid = p.index;
      if (pid === ownerId) continue;
      if (p.faction !== '魏') continue;

      offs.push(
        registerAction(
          state,
          skill.id,
          pid,
          'respond',
          (st: GameState, params: Record<string, Json>): string | null => {
            const check = requireRequestType(
              st,
              pid,
              opts.passiveDraw ? [DODGE_RT, REQUEST_TYPE] : [DODGE_RT],
              { mismatchError: `当前不是${SKILL_ID}询问` },
            );
            if (check.error) return check.error;
            if (check.requestType === DODGE_RT) {
              // 护驾代出闪:有 cardId 必须是手牌中的闪
              const cardId = params.cardId as string | undefined;
              if (cardId) {
                if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
                if (st.cardMap[cardId]?.name !== '闪') return '只能打出闪';
              }
              return null;
            }
            // 界版 drawChoice:回应"是否令曹操摸牌"(confirm,无 cardId)
            return null;
          },
          async (st: GameState, params: Record<string, Json>): Promise<void> => {
            const requestType = currentRequestType(st, pid);
            if (requestType === DODGE_RT) {
              const cardId = params.cardId as string | undefined;
              if (cardId) {
                st.localVars[DODGE_PLAYED_VAR] = cardId;
              }
              // cardId 为空 = 不出闪(拒绝护驾)
            } else if (requestType === REQUEST_TYPE) {
              // 回应"是否令曹操摸牌"(与出闪共用注册键,见上)
              st.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
            }
          },
        ),
      );
    }

    if (!opts.declareAltFirst) {
      unloadDecl = declareAlternativeResponse(state, ownerId, '询问闪');
      offs.push(unloadDecl);
    }

    if (opts.unloadAll) {
      // 界版:回收全部注册
      return () => {
        for (const off of offs) off();
      };
    }
    // 标版历史行为:仅回收替代回应声明(respond 注册的卸载器不回收)
    return () => {
      unloadDecl();
    };
  }

  function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
    // 护驾 respond:单注册,按 pending 内容分支(镜像 激将 的单 respond 模式)。
    //   - 曹操被询问闪(atom.type==='询问闪',target=曹操):confirm 发动护驾
    //   - 魏势力角色收到 出闪 询问:出闪(卡牌选择由 pending 驱动)
    //   - 界版:魏势力角色收到"是否令曹操摸牌"询问:confirm(文案由 pending.prompt 驱动)
    // 注:前端 skillActionRegistry 以 `${skillId}:${ownerId}:${actionType}` 为键、
    //   用 Map.set 覆盖;同 key 的第二次 defineAction 会覆盖第一次。故多条 respond
    //   必须合并为一条,否则曹操的护驾按钮会被魏角色定义覆盖而无法发动护驾。
    //   魏角色的出闪卡牌筛选由 pending 的 candidates(投影层注入)驱动,不依赖本 action。
    defineConfirmAction(api, 'respond', {
      label: opts.displayName,
      title: '护驾:令魏势力角色替你出闪?',
      confirmLabel: '护驾',
      activeWhen: (ctx) => {
        const slot = ctx.view.pending;
        if (!slot) return false;
        if (slot.target !== ctx.perspectiveIdx) return false;
        const atom = slot.atom as { type: string; requestType?: string };
        // 曹操被询问闪 → 发动护驾(confirm)
        if (atom.type === '询问闪') return true;
        // 魏势力角色收到 出闪 询问 → 出闪(卡牌选择由 pending 驱动)
        if (atom.type === '请求回应' && atom.requestType === DODGE_RT) return true;
        if (opts.passiveDraw) {
          // 魏势力角色收到"是否令曹操摸牌"询问 → confirm
          if (atom.type === '请求回应' && atom.requestType === REQUEST_TYPE) return true;
        }
        // 势力检查由后端 validate 处理(GameView 不暴露 faction)
        return false;
      },
    });

    return;
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: HujiaOptions = {
  skillId: '护驾',
  displayName: '护驾',
  description: '主公技:需要闪时,令其他魏势力角色替你打出闪',
  lordOnly: false,
  passiveDraw: false,
  declareAltFirst: false,
  unloadAll: false,
};

export const { createSkill, onInit, onMount } = createHujiaSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;

// [requestType 迁移·不迁项] respond 校验里的 slot.atom 另用于 atom.type !== '询问闪'
// 出闪窗口判定(非 requestType),保留手写 pendingSlots.get;requestType 读取已走 currentRequestType。
