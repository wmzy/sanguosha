// 界利驭(界吕布·群·被动技,OL hero/319 官方逐字):
//   当你使用【杀】对其他角色造成伤害后,你可以获得其区域里的一张牌,
//   若获得的牌:不为装备牌,其摸一张牌;为装备牌,
//   你视为对由其指定的另一名角色使用一张【决斗】。
//
// 实现(被动 after-hook + 三步交互):
//   造成伤害 after-hook(source===ownerId 且 target!==ownerId 且 amount>0
//   且伤害来源牌为【杀】):
//     1. 询问是否发动(请求回应 requestType='界利驭/confirm',confirm prompt,target=吕布)
//     2. confirm 后弹选牌面板(请求回应 requestType='界利驭/选牌',pickTargetCard prompt,
//        target=吕布):吕布从受伤目标区域选一张牌获得(手牌/装备/判定区均可见/可选,
//        includeJudge=true —— "区域里的一张牌"按 OL 规则含三大区)
//     3. 判断获得牌是否装备:
//        - 非装备 → 受伤目标摸 1 张(摸牌 count=1)
//        - 装备   → 询问受伤目标选择另一名角色(请求回应 requestType=
//          '界利驭/chooseDuelTarget',choosePlayer prompt,target=受伤目标)
//          → 吕布视为对该角色使用决斗
//
// 关键点:
//   - 触发条件严格匹配"使用【杀】对其他角色造成伤害":
//     source=ownerId(界吕布自己), target≠ownerId(其他角色), amount>0,
//     伤害来源牌为【杀】(检查 cardId 对应的卡名)。转化杀(武圣/丈八)的影子卡
//     name 仍为 '杀',自然匹配;决斗/反馈等非杀伤害被正确排除。
//   - "区域里的一张牌":按 OL 官方规则含手牌+装备+判定区(includeJudge=true)。
//   - 装备分支的"另一名角色":受伤目标选择,排除吕布自己和受伤目标,须存活。
//     若场上无其他可选角色(仅2人时),跳过决斗(不能强制进行)。
//   - 视为决斗:吕布是决斗发起者(出杀后手),所选角色是目标(出杀先手);
//     无实体牌;按惯例(与离间/界势斩一致)跳过无懈可击。
//   - 决斗结算前 pushFrame 隔离处理区:造成伤害 after-hook 触发时,父杀帧的
//     frameCards 仍含原杀牌;若直接 runDuelResolution,决斗循环的
//     frameCards.filter(杀) 会误判"已出杀",导致秒结束。push 新帧后 topFrame.cards
//     为空,决斗循环正常。
//   - requestType 一律以 '界利驭/' 为前缀:resolvePendingRespond 按 [/_] 取首段为
//     skillId,须与 skill.id('界利驭')一致,否则前端/无头客户端路由不到 respond。
//   - respond action 须注册到全部玩家座次:confirm/选牌 仅吕布(pending.target=ownerId)
//     能回应,chooseDuelTarget 仅受伤目标(pending.target=受伤目标)能回应。
//     默认 registerAction 只挂在 owner=吕布 座次,受伤目标 dispatch 找不到 action →
//     受伤目标无法选决斗对象。故仿 界护驾/标护驾 跨座次注册模式,为每个玩家注册一份。
//     validate/execute 通过 pendingSlots.get(pid) 自然区分谁该回应:每个 pid 只能看到
//     target=自己 的 pending,其他 pending 对其不可见 → 自动路由。
//
// 命名:文件名/loader key/character skill name 均为 '界利驭'(避开标版未实现的"利驭");
//   内部 Skill.name = '利驭'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';
import { runPickTargetCardPanel } from './选牌面板';
import { runDuelResolution } from './决斗';

const SKILL_ID = '界利驭';
const DISPLAY_NAME = '利驭';

const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const DUEL_TARGET_KEY = `${SKILL_ID}/duelTarget`;
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const PICK_RT = `${SKILL_ID}/选牌`;
const CHOOSE_DUEL_RT = `${SKILL_ID}/chooseDuelTarget`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '当你使用【杀】对其他角色造成伤害后,你可以获得其区域里的一张牌;获得的牌不为装备牌,其摸一张牌;为装备牌,你视为对由其指定的另一名角色使用一张【决斗】',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const offs: Array<() => void> = [];

  // respond:为每个玩家注册一份(跨座次注册模式)。
  // 每个 pid 只能看到 target=自己 的 pending,故 validate/execute 通过
  // pendingSlots.get(pid) 自然区分:
  //   - CONFIRM_RT / PICK_RT:仅吕布(pid===ownerId)有该 pending
  //   - CHOOSE_DUEL_RT      :仅受伤目标(pid===pending.target)有该 pending
  for (const player of state.players) {
    const pid = player.index;

    offs.push(
      registerAction(
        state,
        skill.id,
        pid,
        'respond',
        (s, params) => {
          const slot = s.pendingSlots.get(pid);
          if (!slot) return '当前不需要回应';
          if (slot.atom.type !== '请求回应') return '当前不需要回应';
          const requestType = (slot.atom as { requestType?: string }).requestType;
          if (requestType === CONFIRM_RT) {
            // confirm:接受 choice/confirmed 布尔
            return null;
          }
          if (requestType === PICK_RT) {
            // 选牌面板:校验 zone + cardId/handIndex(同反馈/过河拆桥)
            const zone = params.zone;
            if (zone === 'equipment' || zone === 'judge') {
              if (typeof params.cardId !== 'string') return 'cardId required';
            } else if (zone === 'hand') {
              if (typeof params.handIndex !== 'number') return 'handIndex required';
            } else {
              return 'zone required (equipment|hand|judge)';
            }
            return null;
          }
          if (requestType === CHOOSE_DUEL_RT) {
            // 受伤目标选择决斗对象
            if (typeof params.target !== 'number') return 'target required';
            return null;
          }
          return '当前不是利驭回应';
        },
        async (s, params) => {
          const slot = s.pendingSlots.get(pid);
          const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (requestType === CONFIRM_RT) {
            s.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
          } else if (requestType === PICK_RT) {
            s.localVars['选牌/结果'] = {
              zone: params.zone,
              cardId: params.cardId ?? null,
              handIndex: params.handIndex ?? null,
            };
          } else if (requestType === CHOOSE_DUEL_RT) {
            s.localVars[DUEL_TARGET_KEY] = params.target;
          }
        },
      ),
    );
  }

  offs.push(
    registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if (atom.target === undefined || atom.target === ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      // 必须是【杀】造成的伤害(转化杀的影子卡 name 仍为 '杀')
      if (typeof atom.cardId !== 'string') return;
      const srcCard = ctx.state.cardMap[atom.cardId];
      if (!srcCard || srcCard.name !== '杀') return;

      const target = atom.target;
      const targetPlayer = ctx.state.players[target];
      if (!targetPlayer?.alive) return;

      // 目标区域必须有牌(手牌/装备/判定区任一)
      const hasCards =
        targetPlayer.hand.length > 0 ||
        Object.keys(targetPlayer.equipment).length > 0 ||
        targetPlayer.pendingTricks.length > 0;
      if (!hasCards) return;

      // 1. 询问是否发动利驭
      delete ctx.state.localVars[CONFIRM_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动利驭?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars[CONFIRM_KEY]) return;
      delete ctx.state.localVars[CONFIRM_KEY];

      // 2. 弹选牌面板:从受伤目标区域选一张牌获得(手牌+装备+判定区)
      const targetBefore = ctx.state.players[target];
      if (!targetBefore) return;
      await runPickTargetCardPanel(ctx.state, ownerId, target, targetBefore, {
        mode: 'obtain',
        requestType: PICK_RT,
        title: '利驭:选择获得受伤目标区域里的一张牌',
        includeJudge: true,
      });

      // 3. 判断刚获得的牌类型:获得原子 push 到 owner.hand 末尾,取末位即所得牌
      const ownerPlayer = ctx.state.players[ownerId];
      if (!ownerPlayer) return;
      const obtainedId = ownerPlayer.hand[ownerPlayer.hand.length - 1] ?? null;
      if (obtainedId === null) return;
      const obtainedCard = ctx.state.cardMap[obtainedId];
      if (!obtainedCard) return;

      if (obtainedCard.type !== '装备牌') {
        // 非装备(手牌/锦囊):受伤目标摸 1 张
        await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
        return;
      }

      // 装备:询问受伤目标选择另一名角色(排除吕布自己和受伤目标,须存活)
      const candidates = ctx.state.players
        .filter((p) => p.alive && p.index !== ownerId && p.index !== target)
        .map((p) => p.index);
      if (candidates.length === 0) return; // 场上无其他可选角色,跳过决斗

      delete ctx.state.localVars[DUEL_TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOOSE_DUEL_RT,
        target, // 受伤目标选择
        prompt: {
          type: 'choosePlayer',
          title: '利驭:选择另一名角色,界吕布视为对其使用决斗',
          min: 1,
          max: 1,
          filter: (view, t) =>
            t !== ownerId && t !== target && view.players[t]?.alive === true,
        },
        defaultChoice: candidates[0],
        timeout: 15,
      });
      const duelTarget = ctx.state.localVars[DUEL_TARGET_KEY] as number | undefined;
      delete ctx.state.localVars[DUEL_TARGET_KEY];
      if (typeof duelTarget !== 'number') return;
      if (duelTarget === ownerId || duelTarget === target) return;
      if (!ctx.state.players[duelTarget]?.alive) return;

      // 4. 利驭主(吕布)视为对所选角色使用决斗:
      //    - 必须新帧隔离处理区:此时父杀帧 frameCards 仍含原杀牌,直接 runDuelResolution
      //      会被 决斗 frameCards.filter(杀) 误判"已出杀"秒结束。
      //    - 吕布是决斗发起者(from,出杀后手);所选角色是目标(target,出杀先手)。
      //    - 无实体牌(视为使用);按惯例(离间/界势斩)跳过无懈可击。
      await pushFrame(ctx.state, SKILL_ID, ownerId, { duelTarget, source: target });
      try {
        if (ctx.state.players[ownerId]?.alive && ctx.state.players[duelTarget]?.alive) {
          await runDuelResolution(ctx.state, ownerId, duelTarget, undefined, true);
        }
      } finally {
        await popFrame(ctx.state);
      }
    }),
  );

  return () => {
    for (const off of offs) off();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动利驭?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
