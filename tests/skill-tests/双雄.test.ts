// 双雄(颜良文丑·群雄)行为测试:
//   A) 摸牌阶段触发(阶段开始 before-hook):
//      1. 发动双雄 → 进行一次判定 → 获得判定牌(进手牌)→ 记颜色 → 跳过默认摸牌
//      2. 不发动 → 走默认摸牌(无颜色标记)
//      3. 牌堆为空 → 不触发双雄(不询问)
//   B) 转化(transform,preceding 决斗.use):
//      4. transformThenUse:判定黑色 → 红色手牌当决斗 → P2 不出杀扣血
//      5. 负面:同色手牌(判定黑色,出黑色手牌)→ 拒绝
//      6. 负面:未发动双雄(无颜色) → 拒绝
//      7. availableActions:transform 声明
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('双雄', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── A1. 发动双雄:判定+获得判定牌+记颜色+跳过默认摸牌 ─────────

  it('摸牌阶段发动双雄 → 进行一次判定 → 获得判定牌 → 记颜色 → 跳过默认摸牌', async () => {
    // 「判定」atom 从牌堆顶(deck[0])翻一张。
    // deck=[j1(♥), topIsHeart] → 判定牌为 j1(♥,红色)→ 进入玩家手牌,记 color=red
    // 跳过默认摸牌后:手牌=[j1](获得判定牌),未摸 2 张
    const restoreAutoCompare = disableAutoCompare();
    const j1 = makeCard('j1', '杀', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: [], skills: ['双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { j1 },
        zones: { deck: ['j1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('颜良文丑');

    // 触发摸牌阶段开始(双雄 before-hook 询问)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    Y.expectPending('请求回应');

    // 选择发动双雄
    await Y.respond('双雄', { choice: true });
    await harness.waitForStable();

    // 本回合决斗颜色记为 红色(♥ 判定牌)
    expect(harness.state.turn.vars['双雄/color']).toBe('红');
    // 判定牌进入手牌(获得判定牌)
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.players[0].hand).toHaveLength(1);
    // 跳过默认摸牌:不另外摸 2 张(只有判定牌入手)
    // 判定牌不在弃牌堆(已被玩家获得)
    expect(harness.state.zones.discardPile).not.toContain('j1');
    // 牌堆已空(判定翻走唯一一张)
    expect(harness.state.zones.deck).toHaveLength(0);
    // 处理区清空
    expect(harness.state.zones.processing).toHaveLength(0);
    // view 侧 turnUsage 同步了颜色(供前端 activeWhen 读)
    Y.processEvents();
    Y.expectView((v) => {
      expect(v.players[0].turnUsage?.['双雄/color']).toBe('红');
    });
    restoreAutoCompare();
  });

  // ─── A1b. 发动双雄:判定为黑色 → 记 black ─────────────────────

  it('摸牌阶段发动双雄 → 判定黑色(♠)→ 颜色记为 black', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const j1 = makeCard('j1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: [], skills: ['双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { j1 },
        zones: { deck: ['j1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('颜良文丑');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    Y.expectPending('请求回应');

    await Y.respond('双雄', { choice: true });
    await harness.waitForStable();

    // 判定 ♠(黑色)→ 颜色记为 黑
    expect(harness.state.turn.vars['双雄/color']).toBe('黑');
    expect(harness.state.players[0].hand).toContain('j1');
    restoreAutoCompare();
  });

  // ─── A2. 不发动双雄 → 走默认摸牌(无颜色标记) ──────────────────

  it('不发动双雄 → 无颜色标记(默认摸牌由回合管理处理)', async () => {
    const j1 = makeCard('j1', '桃', '♥', 'A');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: [], skills: ['双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { j1 },
        zones: { deck: ['j1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('颜良文丑');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    Y.expectPending('请求回应');

    // 选择不发动
    await Y.respond('双雄', { choice: false });
    await harness.waitForStable();

    // 未发动 → 无颜色标记
    expect(harness.state.turn.vars['双雄/color']).toBeUndefined();
    // 牌堆未消耗(没判定),判定牌未入手
    expect(harness.state.zones.deck).toHaveLength(1);
    expect(harness.state.players[0].hand).not.toContain('j1');
  });

  // ─── A3. 牌堆仅 1 张也能发动(新机制只需 1 张判定牌) ────────

  it('牌堆仅 1 张 → 发动双雄 → 翻走该张判定牌,牌堆变空', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const j1 = makeCard('j1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: [], skills: ['双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { j1 },
        zones: { deck: ['j1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('颜良文丑');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    Y.expectPending('请求回应');

    await Y.respond('双雄', { choice: true });
    await harness.waitForStable();

    // 1 张牌被翻走作判定牌,牌堆变空
    expect(harness.state.zones.deck).toHaveLength(0);
    // 判定牌已入手
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.turn.vars['双雄/color']).toBe('黑');
    restoreAutoCompare();
  });

  // ─── B4. transformThenUse:判定黑色→红色手牌当决斗 → P2 扣血 ────

  it('transformThenUse:发动双雄后(判定黑色),红色手牌当决斗 → P2 不出杀扣1血', async () => {
    // 模拟双雄已发动:turn.vars['双雄/color']='black'(判定牌为黑色)
    // P1 手牌:c1(♥闪,红色,异色可转化)
    // P2 无杀 → 决斗中 P2 先被询问杀 → pass → P2 输 → 扣1血
    const c1 = makeCard('c1', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: ['c1'], skills: ['双雄', '决斗'] }),
          makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '双雄/color': '黑' } },
      }),
    );
    const P1 = harness.player('颜良文丑');
    const P2 = harness.player('P2');
    const p2HealthBefore = harness.state.players[1].health;

    // 转化:c1(♥红色,与判定黑色异色)当决斗。影子 id = c1#双雄
    await P1.transformThenUse('双雄', { cardId: 'c1' }, '决斗', {
      cardId: 'c1#双雄',
      targets: [1],
    });

    // 影子卡已建立:名为"决斗"
    expect(harness.state.cardMap['c1#双雄']).toBeDefined();
    expect(harness.state.cardMap['c1#双雄'].name).toBe('决斗');
    // 原卡从手牌移除(被影子卡替换)
    expect(harness.state.players[0].hand).not.toContain('c1');

    // 窗口1:无懈可击(broadcast)→ pass
    await P1.pass();
    // 窗口2:P2 被询问出杀(决斗目标先出杀)
    P2.expectPending('询问杀');
    await P2.pass(); // P2 无杀 → 输

    // P2 扣1血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 影子决斗入弃牌堆时还原为原卡(shadowOf=c1),故弃牌堆含 c1
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.processing).toHaveLength(0);
  });

  // ─── B5. 负面:同色手牌 → 拒绝 ────────────────────────────

  it('transform:颜色相同(判定黑色,出♠黑色牌)→ 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2'); // ♠ 黑色
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: ['c1'], skills: ['双雄', '决斗'] }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '双雄/color': '黑' } },
      }),
    );
    const P1 = harness.player('颜良文丑');

    await P1.expectRejected({
      skillId: '双雄',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });

    // 状态未变:原卡仍在手牌,无影子卡
    expect(harness.state.cardMap['c1#双雄']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── B6. 负面:未发动双雄(无颜色) → 拒绝 ──────────────────────

  it('transform:未发动双雄(turn.vars 无颜色)→ 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: ['c1'], skills: ['双雄', '决斗'] }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} }, // 未发动双雄
      }),
    );
    const P1 = harness.player('颜良文丑');

    await P1.expectRejected({
      skillId: '双雄',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });

    expect(harness.state.cardMap['c1#双雄']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── B7. availableActions:transform 声明 ──────────────────────

  it('availableActions:双雄 transform + respond 声明', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '颜良文丑', hand: ['c1'], skills: ['双雄', '决斗'] }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '双雄/color': '黑' } },
      }),
    );
    const P1 = harness.player('颜良文丑');
    await P1.loadFrontend();

    const actions = P1.availableActions();
    const transform = actions.find((a) => a.skillId === '双雄' && a.actionType === 'transform');
    expect(transform).toBeDefined();
    expect(transform?.label).toBe('双雄');
    expect(transform?.prompt.type).toBe('useCardAndTarget');
    // activeWhen 已声明(已发动 + 有异色手牌时激活)
    expect(typeof transform?.activeWhen).toBe('function');
  });
});
