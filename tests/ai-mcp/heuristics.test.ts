// tests/ai-mcp/heuristics.test.ts
// 启发式策略评分器测试。纯函数，直接构造 AiViewSnapshot / AvailableAction fixtures。
import { describe, it, expect } from 'vitest';
import {
  scoreAction,
  rankActions,
  pickBestAction,
  scoreAll,
  wuxieThreatLevel,
  wuxieTargetValue,
  countWuxieInHand,
} from '../../src/ai-mcp/heuristics';
import type { AiViewSnapshot, AvailableAction } from '../../src/client/headless/types';
import type { Card } from '../../src/engine/types';

// ── fixtures ────────────────────────────────────────────────────────

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    name: '杀',
    suit: '♠',
    color: '黑',
    rank: '5',
    type: '基本牌',
    ...over,
  };
}

function makePlayer(
  over: Partial<AiViewSnapshot['players'][number]> = {},
): AiViewSnapshot['players'][number] {
  return {
    index: 0,
    name: 'P0',
    character: '刘备',
    health: 4,
    maxHealth: 4,
    alive: true,
    handCount: 1,
    equipment: {},
    skills: [],
    ...over,
  };
}

/** 默认 2 人局：viewer=P0(满血)，P1 对手(满血)。无 pending（出牌阶段）。 */
function makeView(over: Partial<AiViewSnapshot> = {}): AiViewSnapshot {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1 },
    players: [
      makePlayer({ index: 0, name: 'P0' }),
      makePlayer({ index: 1, name: 'P1', character: '张飞' }),
    ],
    pending: null,
    zones: { deckCount: 50, discardPileCount: 0 },
    log: [],
    ...over,
  };
}

function playAction(card: Card, validTargets: number[] = []): AvailableAction {
  return {
    description: `使用【${card.name}】`,
    message: {
      skillId: card.name,
      actionType: 'use',
      ownerId: 0,
      params: { cardId: card.id },
      baseSeq: 0,
    },
    validTargets,
    category: 'play',
  };
}

function respondAction(skillId: string, card?: Card): AvailableAction {
  return {
    description: `回应【${skillId}】`,
    message: {
      skillId,
      actionType: 'respond',
      ownerId: 0,
      params: card ? { cardId: card.id } : {},
      baseSeq: 0,
    },
    validTargets: [],
    category: 'respond',
  };
}

function skipAction(): AvailableAction {
  return {
    description: '跳过',
    message: { skillId: '__skip', actionType: 'skip', ownerId: 0, params: {}, baseSeq: 0 },
    validTargets: [],
    category: 'skip',
  };
}

// ── 评分钳制 ────────────────────────────────────────────────────────

describe('scoreAction 区间钳制', () => {
  it('所有动作评分在 0-100 之间', () => {
    const view = makeView();
    const actions: AvailableAction[] = [
      playAction(makeCard({ id: 'kill', name: '杀' }), [1]),
      respondAction('闪'),
      skipAction(),
    ];
    for (const a of actions) {
      const { score } = scoreAction(view, a);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it('返回带理由字符串', () => {
    const view = makeView();
    const { reason } = scoreAction(view, playAction(makeCard({ id: 'kill', name: '杀' }), [1]));
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
  });
});

// ── respond 类（救命最高）────────────────────────────────────────────

describe('respond 类评分', () => {
  it('自己濒死时出桃=100（救命最高分）', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出桃', requestType: '桃' },
      players: [
        makePlayer({ index: 0, health: 0, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const { score, reason } = scoreAction(view, respondAction('桃'));
    expect(score).toBe(100);
    expect(reason).toContain('自救');
  });

  it('队友濒死时出桃=95', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出桃', requestType: '桃' },
      players: [
        makePlayer({ index: 0, health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P1', health: 0, maxHealth: 4 }),
      ],
    });
    const { score } = scoreAction(view, respondAction('桃'));
    expect(score).toBe(95);
  });

  it('被杀出闪=90', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出闪', requestType: '闪' },
    });
    const { score } = scoreAction(view, respondAction('闪'));
    expect(score).toBe(90);
  });

  it('残血被杀出闪=98（保命加权）', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出闪', requestType: '闪' },
      players: [
        makePlayer({ index: 0, health: 1, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const { score } = scoreAction(view, respondAction('闪'));
    expect(score).toBe(98);
  });

  it('询问杀出杀=80', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出杀', requestType: '杀' },
    });
    const { score } = scoreAction(view, respondAction('杀'));
    expect(score).toBe(80);
  });

  it('无懈可击应对关键锦囊(广播,第1轮)=85（威胁90-轮次5）', () => {
    const view = makeView({
      pending: { target: -1, isBlocking: false, promptTitle: '是否打出无懈可击(顺手牵羊)', requestType: '' },
    });
    const { score } = scoreAction(view, respondAction('无懈可击'));
    expect(score).toBe(85); // critical 90 + 轮次(第1轮)-5
  });

  it('无懈可击应对普通锦囊(广播,第1轮)=55（未知威胁60-轮次5）', () => {
    const view = makeView({
      pending: { target: -1, isBlocking: false, promptTitle: '是否打出无懈可击', requestType: '' },
    });
    const { score } = scoreAction(view, respondAction('无懈可击'));
    expect(score).toBe(55); // medium 60 + 轮次(第1轮)-5
  });

  it('无懈可击保护满血盟友(强力武将)时评分较高（高于敌方）', () => {
    const view = makeView({
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼' }),
        makePlayer({ index: 1, name: 'P1', identity: '反贼' }),
        makePlayer({ index: 2, name: 'P2', identity: '主公' }),
      ],
      pending: { target: 1, isBlocking: false, promptTitle: '是否打出无懈可击(顺手牵羊)', requestType: '' },
    });
    const { score, reason } = scoreAction(view, respondAction('无懈可击'));
    // 满血盟友(刘备,价值60) 被critical(90)威胁: (90+60)/2=75, 第1轮-5, 手牌无无懈-5 = 65
    expect(score).toBeGreaterThanOrEqual(60);
    expect(reason).toContain('盟友');
  });

  // ── P0-2: 无懈可击智能判断细化（目标价值+阵营+手牌+阶段）──

  it('残血盟友被顺手牵羊 → 高分无懈（>85）', () => {
    const wuxie1 = makeCard({ id: 'wx1', name: '无懈可击', type: '锦囊牌' });
    const wuxie2 = makeCard({ id: 'wx2', name: '无懈可击', type: '锦囊牌' });
    const view = makeView({
      turn: { round: 3 },
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼', handCount: 2, hand: [wuxie1, wuxie2] }),
        makePlayer({
          index: 1,
          name: 'P1',
          identity: '反贼',
          health: 1,
          maxHealth: 4,
          handCount: 5,
          character: '华佗',
        }),
        makePlayer({ index: 2, name: 'P2', identity: '主公' }),
      ],
      pending: { target: 1, isBlocking: false, promptTitle: '是否打出无懈可击(顺手牵羊)', requestType: '' },
    });
    const { score, reason } = scoreAction(view, respondAction('无懈可击', wuxie1));
    // 残血(+20)+多牌(+10)+核心武将(+10)=90; (90+90)/2=90; 手牌2张无修正; 第3轮轮次0 = 90
    expect(score).toBeGreaterThan(85);
    expect(reason).toContain('盟友');
  });

  it('满血盟友被桃园结义 → 低分无懈（不值得挡敌方回血）', () => {
    const wuxie = makeCard({ id: 'wx', name: '无懈可击', type: '锦囊牌' });
    const view = makeView({
      turn: { round: 3 },
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼', handCount: 1, hand: [wuxie] }),
        makePlayer({ index: 1, name: 'P1', identity: '反贼', health: 4, maxHealth: 4, handCount: 1 }),
        makePlayer({ index: 2, name: 'P2', identity: '主公' }),
      ],
      pending: { target: 1, isBlocking: false, promptTitle: '是否打出无懈可击(桃园结义)', requestType: '' },
    });
    const { score } = scoreAction(view, respondAction('无懈可击', wuxie));
    // low(40); (40+60)/2=50; 手牌1张-5 = 45
    expect(score).toBeLessThan(50);
  });

  it('手牌仅1张无懈时对盟友威胁 → 评分比2张时略降（手牌修正-5）', () => {
    const wuxie = makeCard({ id: 'wx', name: '无懈可击', type: '锦囊牌' });
    const wuxie2 = makeCard({ id: 'wx2', name: '无懈可击', type: '锦囊牌' });
    const base = {
      turn: { round: 3 },
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼' }),
        makePlayer({ index: 1, name: 'P1', identity: '反贼', health: 4, maxHealth: 4, handCount: 1 }),
        makePlayer({ index: 2, name: 'P2', identity: '主公' }),
      ],
      pending: { target: 1, isBlocking: false, promptTitle: '是否打出无懈可击(借刀杀人)', requestType: '' },
    };
    const view1 = makeView({
      ...base,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼', handCount: 1, hand: [wuxie] }),
        base.players[1],
        base.players[2],
      ],
    });
    const view2 = makeView({
      ...base,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼', handCount: 2, hand: [wuxie, wuxie2] }),
        base.players[1],
        base.players[2],
      ],
    });
    const s1 = scoreAction(view1, respondAction('无懈可击', wuxie)).score;
    const s2 = scoreAction(view2, respondAction('无懈可击', wuxie)).score;
    // high(75); (75+60)/2=68; 1张无X-5=63, 2张无修正=68
    expect(s1).toBeLessThan(s2);
    expect(s2 - s1).toBe(5);
  });

  it('敌方被南蛮入侵（仅2人存活）→ 不值得无懈（<30）', () => {
    const wuxie = makeCard({ id: 'wx', name: '无懈可击', type: '锦囊牌' });
    const view = makeView({
      turn: { round: 3 },
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼', handCount: 1, hand: [wuxie] }),
        makePlayer({ index: 1, name: 'P1', identity: '主公' }),
        makePlayer({ index: 2, name: 'P2', identity: '忠臣', alive: false }),
      ],
      pending: { target: 1, isBlocking: false, promptTitle: '是否打出无懈可击(南蛮入侵)', requestType: '' },
    });
    const { score, reason } = scoreAction(view, respondAction('无懈可击', wuxie));
    // 敌方被指定 → 默认保留无懈 = 20
    expect(score).toBeLessThan(30);
    expect(reason).toContain('保留');
  });

  it('自己被乐不思蜀 → 最高分无懈', () => {
    const wuxie = makeCard({ id: 'wx', name: '无懈可击', type: '锦囊牌' });
    const view = makeView({
      turn: { round: 5 },
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼', handCount: 1, hand: [wuxie] }),
        makePlayer({ index: 1, name: 'P1', identity: '主公' }),
      ],
      pending: { target: 0, isBlocking: false, promptTitle: '是否打出无懈可击(乐不思蜀)', requestType: '' },
    });
    const { score, reason } = scoreAction(view, respondAction('无懈可击', wuxie));
    // critical(90)+自身+5+后期轮次+5 = 100
    expect(score).toBeGreaterThanOrEqual(95);
    expect(reason).toContain('自保');
  });

  // ── 直接测试导出的辅助函数 ──

  it('wuxieThreatLevel 按牌名分类威胁等级', () => {
    expect(wuxieThreatLevel('顺手牵羊').level).toBe('critical');
    expect(wuxieThreatLevel('过河拆桥').score).toBe(90);
    expect(wuxieThreatLevel('乐不思蜀').level).toBe('critical');
    expect(wuxieThreatLevel('借刀杀人').level).toBe('high');
    expect(wuxieThreatLevel('火攻').score).toBe(75);
    expect(wuxieThreatLevel('南蛮入侵').level).toBe('medium');
    expect(wuxieThreatLevel('万箭齐发').score).toBe(60);
    expect(wuxieThreatLevel('桃园结义').level).toBe('low');
    expect(wuxieThreatLevel('五谷丰登').score).toBe(40);
    expect(wuxieThreatLevel('某未知锦囊').level).toBe('medium');
  });

  it('wuxieTargetValue 残血+多牌+核心武将 → 高保护价值', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
        makePlayer({
          index: 1,
          name: 'P1',
          health: 1,
          maxHealth: 4,
          handCount: 5,
          character: '孙权',
        }),
      ],
    });
    // 50 + 残血20 + 多牌10 + 核心10 = 90
    expect(wuxieTargetValue(view, 1)).toBe(90);
  });

  it('countWuxieInHand 统计手牌中无懈可击数量', () => {
    const view = makeView({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [
            makeCard({ id: 'wx1', name: '无懈可击', type: '锦囊牌' }),
            makeCard({ id: 'k', name: '杀' }),
            makeCard({ id: 'wx2', name: '无懈可击', type: '锦囊牌' }),
          ],
        }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    expect(countWuxieInHand(view)).toBe(2);
  });
});

// ── skip 类 ─────────────────────────────────────────────────────────

describe('skip 类评分', () => {
  it('广播型 pending（无懈）skip=60（保留无懈通常正确）', () => {
    const view = makeView({
      pending: { target: -1, isBlocking: false, promptTitle: '是否打出无懈可击', requestType: '' },
    });
    const { score } = scoreAction(view, skipAction());
    expect(score).toBe(60);
  });

  it('阻塞回应 skip=承受伤害=40', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出闪', requestType: '闪' },
    });
    const { score } = scoreAction(view, skipAction());
    expect(score).toBe(40);
  });

  it('残血阻塞回应 skip=20（濒危）', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出闪', requestType: '闪' },
      players: [
        makePlayer({ index: 0, health: 1, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const { score } = scoreAction(view, skipAction());
    expect(score).toBe(20);
  });

  it('通用 skip 兜底=30', () => {
    const view = makeView(); // 无 pending
    const { score } = scoreAction(view, skipAction());
    expect(score).toBe(30);
  });

  it('无懈可击 skip 在盟友被攻击时降分', () => {
    const view = makeView({
      viewer: 0,
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼' }),
        makePlayer({ index: 1, name: 'P1', identity: '反贼' }),
        makePlayer({ index: 2, name: 'P2', identity: '主公' }),
      ],
      pending: { target: 1, isBlocking: false, promptTitle: '是否打出无懈可击(顺手牵羊)', requestType: '' },
    });
    const { score } = scoreAction(view, skipAction());
    expect(score).toBeLessThanOrEqual(45);
    expect(score).toBeLessThan(60);
  });
});

// ── play 类（主动出牌）──────────────────────────────────────────────

describe('play 类评分', () => {
  it('满血不出桃=10', () => {
    const view = makeView();
    const tao = makeCard({ id: 'tao', name: '桃' });
    const { score } = scoreAction(view, playAction(tao));
    expect(score).toBe(10);
  });

  it('残血出桃回血保命=88', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, health: 1, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const tao = makeCard({ id: 'tao', name: '桃' });
    const { score } = scoreAction(view, playAction(tao));
    expect(score).toBe(88);
  });

  it('不满血出桃回血=55', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, health: 2, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const tao = makeCard({ id: 'tao', name: '桃' });
    const { score } = scoreAction(view, playAction(tao));
    expect(score).toBe(55);
  });

  it('杀无合法目标=5', () => {
    const view = makeView();
    const kill = makeCard({ id: 'kill', name: '杀' });
    const { score } = scoreAction(view, playAction(kill, []));
    expect(score).toBe(5);
  });

  it('杀攻击残血目标=85（可击杀）', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
        makePlayer({ index: 1, name: 'P1', health: 1, maxHealth: 4 }),
      ],
    });
    const kill = makeCard({ id: 'kill', name: '杀' });
    const { score, reason } = scoreAction(view, playAction(kill, [1]));
    expect(score).toBe(85);
    expect(reason).toContain('残血');
  });

  it('杀攻击普通目标=72', () => {
    const view = makeView();
    const kill = makeCard({ id: 'kill', name: '杀' });
    const { score } = scoreAction(view, playAction(kill, [1]));
    expect(score).toBe(72);
  });

  it('无中生有=80（稳定过牌）', () => {
    const view = makeView();
    const wzsy = makeCard({ id: 'wzsy', name: '无中生有', type: '锦囊牌' });
    const { score } = scoreAction(view, playAction(wzsy, []));
    expect(score).toBe(80);
  });

  it('顺手牵羊目标有牌=75', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
        makePlayer({ index: 1, name: 'P1', handCount: 3 }),
      ],
    });
    const ss = makeCard({ id: 'ss', name: '顺手牵羊', type: '锦囊牌' });
    const { score } = scoreAction(view, playAction(ss, [1]));
    expect(score).toBe(75);
  });

  it('顺手牵羊目标无牌=8', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
        makePlayer({ index: 1, name: 'P1', handCount: 0, equipment: {} }),
      ],
    });
    const ss = makeCard({ id: 'ss', name: '顺手牵羊', type: '锦囊牌' });
    const { score } = scoreAction(view, playAction(ss, [1]));
    expect(score).toBe(8);
  });

  it('装备空槽+手牌宽裕=58', () => {
    const equip = makeCard({ id: 'eq', name: '青釭剑', type: '装备牌', subtype: '武器' });
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', handCount: 4, hand: [equip] }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const { score, reason } = scoreAction(view, playAction(equip));
    expect(score).toBe(58);
    expect(reason).toContain('武器');
  });

  it('装备占用槽位=15（收益低）', () => {
    const equip = makeCard({ id: 'eq', name: '青釭剑', type: '装备牌', subtype: '武器' });
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', handCount: 4, equipment: { 武器: 'old-weapon' }, hand: [equip] }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const { score } = scoreAction(view, playAction(equip));
    expect(score).toBe(15);
  });

  it('南蛮入侵=68（注意队友）', () => {
    const view = makeView();
    const nm = makeCard({ id: 'nm', name: '南蛮入侵', type: '锦囊牌' });
    const { score } = scoreAction(view, playAction(nm, []));
    expect(score).toBe(68);
  });

  it('闪电=35（高风险）', () => {
    const view = makeView();
    const sd = makeCard({ id: 'sd', name: '闪电', type: '锦囊牌' });
    const { score } = scoreAction(view, playAction(sd, []));
    expect(score).toBe(35);
  });

  it('默认未特判的锦囊=50', () => {
    const view = makeView();
    const unk = makeCard({ id: 'u', name: '某未知锦囊', type: '锦囊牌' });
    const { score } = scoreAction(view, playAction(unk, []));
    expect(score).toBe(50);
  });

  it('反贼视角下杀优先打主公', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼' }),
        makePlayer({ index: 1, name: 'P1', identity: '主公', health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', identity: '忠臣', health: 4, maxHealth: 4 }),
      ],
    });
    const kill = makeCard({ id: 'kill', name: '杀' });
    const { score, reason } = scoreAction(view, playAction(kill, [1, 2]));
    expect(score).toBe(82);
    expect(reason).toContain('主公');
  });

  it('忠臣视角下不会高评杀主公的目标', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '忠臣' }),
        makePlayer({ index: 1, name: 'P1', identity: '主公', health: 4, maxHealth: 4 }),
      ],
    });
    const kill = makeCard({ id: 'kill', name: '杀' });
    const { score } = scoreAction(view, playAction(kill, [1]));
    expect(score).toBeLessThanOrEqual(10);
  });

  it('AOE 伤害盟友时降分', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', identity: '反贼' }),
        makePlayer({ index: 1, name: 'P1', identity: '反贼' }),
        makePlayer({ index: 2, name: 'P2', identity: '主公' }),
      ],
    });
    const nm = makeCard({ id: 'nm', name: '南蛮入侵', type: '锦囊牌' });
    const { score, reason } = scoreAction(view, playAction(nm, []));
    expect(score).toBe(53); // 68 - 1盟友 * 15
    expect(reason).toContain('盟友');
  });
});

// ── discard / selectChar 类 ─────────────────────────────────────────

describe('discard / selectChar 类评分', () => {
  it('弃牌阶段给出指导理由', () => {
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 2, maxHealth: 2, handCount: 5 }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
      pending: { target: 0, isBlocking: true, promptTitle: '弃牌', requestType: '__弃牌' },
    });
    const action: AvailableAction = {
      description: '弃牌',
      message: { skillId: '系统规则', actionType: 'respond', ownerId: 0, params: { cardIds: [] }, baseSeq: 0 },
      validTargets: [],
      category: 'discard',
    };
    const { score, reason } = scoreAction(view, action);
    expect(score).toBe(50);
    expect(reason).toContain('弃3张');
  });

  it('弃牌阶段优先弃装备牌（手牌含装备+桃，overflow=1）', () => {
    const equip = makeCard({ id: 'eq1', name: '诸葛连弩', type: '装备牌' });
    const tao = makeCard({ id: 'tao1', name: '桃', suit: '♥' });
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 1, maxHealth: 1, handCount: 2, hand: [equip, tao] }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
      pending: { target: 0, isBlocking: true, promptTitle: '弃牌', requestType: '__弃牌' },
    });
    const action: AvailableAction = {
      description: '弃牌',
      message: { skillId: '系统规则', actionType: 'respond', ownerId: 0, params: { cardIds: [] }, baseSeq: 0 },
      validTargets: [],
      category: 'discard',
    };
    const { score, reason } = scoreAction(view, action);
    expect(score).toBe(50);
    // 建议弃装备，不弃桃
    expect(reason).toContain('eq1');
    expect(reason).not.toContain('tao1');
    expect(reason).toContain('诸葛连弩');
  });

  it('弃牌阶段保留桃和闪（手牌含桃+闪+杀*2，overflow=2，建议弃两张杀）', () => {
    const tao = makeCard({ id: 'tao2', name: '桃', suit: '♥' });
    const shan = makeCard({ id: 'shan2', name: '闪', suit: '♦' });
    const kill1 = makeCard({ id: 'kill2a', name: '杀' });
    const kill2 = makeCard({ id: 'kill2b', name: '杀' });
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 2, maxHealth: 2, handCount: 4, hand: [tao, shan, kill1, kill2] }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
      pending: { target: 0, isBlocking: true, promptTitle: '弃牌', requestType: '__弃牌' },
    });
    const action: AvailableAction = {
      description: '弃牌',
      message: { skillId: '系统规则', actionType: 'respond', ownerId: 0, params: { cardIds: [] }, baseSeq: 0 },
      validTargets: [],
      category: 'discard',
    };
    const { reason } = scoreAction(view, action);
    // 建议弃两张杀，保留桃和闪
    expect(reason).toContain('kill2a');
    expect(reason).toContain('kill2b');
    expect(reason).not.toContain('tao2');
    expect(reason).not.toContain('shan2');
  });

  it('已填入高价值 cardIds 时降分（弃了桃→score 25）', () => {
    const tao = makeCard({ id: 'tao3', name: '桃', suit: '♥' });
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 1, maxHealth: 1, handCount: 2, hand: [tao, makeCard({ id: 'kill3', name: '杀' })] }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
      pending: { target: 0, isBlocking: true, promptTitle: '弃牌', requestType: '__弃牌' },
    });
    const action: AvailableAction = {
      description: '弃牌',
      message: { skillId: '系统规则', actionType: 'respond', ownerId: 0, params: { cardIds: ['tao3'] }, baseSeq: 0 },
      validTargets: [],
      category: 'discard',
    };
    const { score, reason } = scoreAction(view, action);
    expect(score).toBe(25);
    expect(reason).toContain('高价值');
  });

  it('已填入低价值 cardIds 时不降分（弃装备→score 55）', () => {
    const equip = makeCard({ id: 'eq4', name: '赤兔', type: '装备牌' });
    const view = makeView({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 1, maxHealth: 1, handCount: 2, hand: [equip, makeCard({ id: 'tao4', name: '桃', suit: '♥' })] }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
      pending: { target: 0, isBlocking: true, promptTitle: '弃牌', requestType: '__弃牌' },
    });
    const action: AvailableAction = {
      description: '弃牌',
      message: { skillId: '系统规则', actionType: 'respond', ownerId: 0, params: { cardIds: ['eq4'] }, baseSeq: 0 },
      validTargets: [],
      category: 'discard',
    };
    const { score, reason } = scoreAction(view, action);
    expect(score).toBe(55);
    expect(reason).toContain('合理');
  });

  it('selectChar 强力武将=60', () => {
    const view = makeView();
    const action: AvailableAction = {
      description: '选择武将【诸葛亮】',
      message: { skillId: '系统规则', actionType: '选将', ownerId: 0, params: { character: '诸葛亮' }, baseSeq: 0 },
      validTargets: [],
      category: 'selectChar',
    };
    const { score } = scoreAction(view, action);
    expect(score).toBe(60);
  });

  it('selectChar 普通武将=45', () => {
    const view = makeView();
    const action: AvailableAction = {
      description: '选择武将【路人甲】',
      message: { skillId: '系统规则', actionType: '选将', ownerId: 0, params: { character: '路人甲' }, baseSeq: 0 },
      validTargets: [],
      category: 'selectChar',
    };
    const { score } = scoreAction(view, action);
    expect(score).toBe(45);
  });
});

// ── rankActions / pickBestAction / scoreAll ─────────────────────────

describe('rankActions / pickBestAction', () => {
  it('按评分降序排序（respond 救命 > play > skip）', () => {
    // 场景：自己濒死被求桃，手牌有桃；同时有一个 play 杀（不该在此刻执行）
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出桃', requestType: '桃' },
      players: [
        makePlayer({
          index: 0,
          health: 0,
          maxHealth: 4,
          hand: [makeCard({ id: 'tao', name: '桃' })],
        }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const actions: AvailableAction[] = [
      skipAction(),
      playAction(makeCard({ id: 'kill', name: '杀' }), [1]),
      respondAction('桃', makeCard({ id: 'tao', name: '桃' })),
    ];
    const ranked = rankActions(view, actions);
    // 出桃救命应排第一
    expect(ranked[0].category).toBe('respond');
    expect(ranked[0].message.skillId).toBe('桃');
    // skip 排最后
    expect(ranked[ranked.length - 1].category).toBe('skip');
  });

  it('同分保持稳定原序', () => {
    const view = makeView();
    // 两张普通杀，都 72 分
    const a1 = playAction(makeCard({ id: 'k1', name: '杀' }), [1]);
    const a2 = playAction(makeCard({ id: 'k2', name: '杀' }), [1]);
    const ranked = rankActions(view, [a1, a2]);
    expect(ranked[0]).toBe(a1);
    expect(ranked[1]).toBe(a2);
  });

  it('不修改原数组', () => {
    const view = makeView();
    const actions = [
      skipAction(),
      playAction(makeCard({ id: 'kill', name: '杀' }), [1]),
    ];
    const snapshot = actions.slice();
    rankActions(view, actions);
    expect(actions).toEqual(snapshot);
  });

  it('pickBestAction 返回最高分动作', () => {
    const view = makeView();
    const actions: AvailableAction[] = [
      skipAction(),
      playAction(makeCard({ id: 'kill', name: '杀' }), [1]), // 72
      playAction(makeCard({ id: 'tao', name: '桃' })),        // 10 满血
    ];
    const best = pickBestAction(view, actions);
    expect(best).not.toBeNull();
    expect(best!.message.skillId).toBe('杀');
  });

  it('pickBestAction 空数组返回 null', () => {
    const view = makeView();
    expect(pickBestAction(view, [])).toBeNull();
  });

  it('scoreAll 返回排序的带理由列表', () => {
    const view = makeView();
    const actions: AvailableAction[] = [
      playAction(makeCard({ id: 'tao', name: '桃' })),        // 10
      playAction(makeCard({ id: 'kill', name: '杀' }), [1]),  // 72
    ];
    const all = scoreAll(view, actions);
    expect(all).toHaveLength(2);
    expect(all[0].score).toBeGreaterThanOrEqual(all[1].score);
    expect(all[0].action.message.skillId).toBe('杀');
    expect(all[0].reason).toContain('杀');
  });
});

// ── 优先级综合（respond > play > discard > skip）────────────────────

describe('优先级综合', () => {
  it('救命桃 > 主动杀 > 弃牌 > 跳过', () => {
    const view = makeView({
      pending: { target: 0, isBlocking: true, promptTitle: '请出桃', requestType: '桃' },
      players: [
        makePlayer({
          index: 0,
          health: 0,
          maxHealth: 4,
          hand: [makeCard({ id: 'tao', name: '桃' })],
        }),
        makePlayer({ index: 1, name: 'P1' }),
      ],
    });
    const s = (a: AvailableAction) => scoreAction(view, a).score;
    const rescue = s(respondAction('桃'));
    const kill = s(playAction(makeCard({ id: 'k', name: '杀' }), [1]));
    const skip = s(skipAction());
    expect(rescue).toBeGreaterThan(kill);
    expect(kill).toBeGreaterThan(skip);
  });
});
