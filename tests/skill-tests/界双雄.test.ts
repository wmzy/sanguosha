// 界双雄(界颜良文丑·群·转化技)测试,OL hero/550 官方逐字:
//   "摸牌阶段结束时,你可以弃置一张牌,然后你本回合可以将一张与之颜色不同的牌
//    当【决斗】使用。结束阶段,你获得本回合对你造成伤害的牌。"
//
// 模型四部分:
//   A) 摸牌阶段结束(after-hook on 阶段结束, phase='摸牌'):
//        询问发动 → 选手牌弃置 → 记 turn.vars['界双雄/color']=弃置牌颜色
//   B) 转化(transform,preceding 决斗.use):异色手牌当决斗
//   C) 造成伤害 after-hook:target=ownerId → 记 cardId 到 turn.vars['界双雄/damageCards']
//   D) 结束阶段(after-hook on 阶段开始, phase='回合结束'):
//        把伤害牌从弃牌堆移到界颜良文丑手牌
//
// 验证:
//   A1. 发动双雄 → 弃置黑色牌 → 记 color=黑
//   A2. 发动双雄 → 弃置红色牌 → 记 color=红
//   A3. 不发动 → 无颜色标记
//   A4. 无手牌 → 不询问发动
//   A5. 摸牌阶段被跳过(NORMAL_KEY 缺失)→ 不触发
//   B6. transformThenUse:弃黑色 → 红色手牌当决斗 → P2 不出杀扣血
//   B7. 负面:同色手牌 → 拒绝
//   B8. 负面:未发动双雄(无颜色)→ 拒绝
//   B9. availableActions:transform + respond 声明
//   C10. 造成伤害 after-hook:杀对界颜良文丑造成伤害 → 记 cardId
//   C11. 多次伤害 → 多张牌记录
//   D12. 结束阶段:获得本回合伤害牌(弃牌堆→手牌)
//   D13. 结束阶段:无伤害牌 → 无操作
//   D14. 结束阶段:伤害牌已被其他技能拿走(不在弃牌堆)→ 跳过
//   E15. 转化卡(影子卡)造成伤害:记录原卡 id(shadowOf),结束阶段获得原卡
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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

describe('界双雄', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── A1. 发动双雄:弃置黑色牌 → 记 color=黑 ─────────────────────

  it('摸牌阶段结束发动双雄 → 弃置黑色手牌 → 记 color=黑,弃置牌入弃牌堆', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const c1 = makeCard('c1', '闪', '♠', '2'); // 弃置代价(黑色)
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '界颜良文丑', hand: ['c1'], skills: ['界双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('界颜良文丑');

    // 阶段开始(摸牌)→ 标记正常开始;再走 阶段结束 → 触发双雄
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    // 询问①:是否发动?
    Y.expectPending('请求回应');
    await Y.respond('界双雄', { choice: true });
    await harness.waitForStable();

    // 询问②:选哪张手牌弃置
    Y.expectPending('请求回应');
    await Y.respond('界双雄', { cardId: 'c1' });
    await harness.waitForStable();

    // c1 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
    // 记颜色=黑
    expect(harness.state.turn.vars['界双雄/color']).toBe('黑');
    // view 侧 turnUsage 同步
    Y.processEvents();
    Y.expectView((v) => {
      expect(v.players[0].turnUsage?.['界双雄/color']).toBe('黑');
    });
    restoreAutoCompare();
  });

  // ─── A2. 发动双雄:弃置红色牌 → 记 color=红 ─────────────────────

  it('摸牌阶段结束发动双雄 → 弃置红色手牌 → 记 color=红', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2'); // 红色
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '界颜良文丑', hand: ['c1'], skills: ['界双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('界颜良文丑');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await Y.respond('界双雄', { choice: true });
    await harness.waitForStable();
    await Y.respond('界双雄', { cardId: 'c1' });
    await harness.waitForStable();

    expect(harness.state.turn.vars['界双雄/color']).toBe('红');
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── A3. 不发动双雄 → 无颜色标记 ──────────────────────────────

  it('不发动双雄 → 无颜色标记(弃置牌不弃)', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '界颜良文丑', hand: ['c1'], skills: ['界双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const Y = harness.player('界颜良文丑');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    Y.expectPending('请求回应');
    await Y.respond('界双雄', { choice: false }); // 不发动
    await harness.waitForStable();

    expect(harness.state.turn.vars['界双雄/color']).toBeUndefined();
    // 手牌未弃
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });

  // ─── A4. 无手牌 → 不询问发动 ──────────────────────────────────

  it('摸牌阶段结束:无手牌 → 不询问发动(无 color 标记)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '界颜良文丑', hand: [], skills: ['界双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    // 无手牌 → 不询问发动(无 请求回应 pending 给界颜良文丑)
    expect(harness.state.pendingSlots.get(0)?.atom.type).not.toBe('请求回应');
    expect(harness.state.turn.vars['界双雄/color']).toBeUndefined();
  });

  // ─── A5. 摸牌阶段被跳过 → 不触发双雄 ──────────────────────────

  it('摸牌阶段被跳过(NORMAL_KEY 缺失)→ 不触发双雄', async () => {
    // 直接 阶段结束(摸牌) 而不先 阶段开始(摸牌) → NORMAL_KEY 未设 → 不触发
    const c1 = makeCard('c1', '闪', '♠', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '界颜良文丑', hand: ['c1'], skills: ['界双雄'] }),
          makePlayer({ index: 1, name: 'P2', skills: [] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );

    // 不先 阶段开始(摸牌),直接 阶段结束 → 模拟跳过情形
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    // 不应触发双雄:无 请求回应 询问,color 未设
    expect(harness.state.pendingSlots.get(0)?.atom.type).not.toBe('请求回应');
    expect(harness.state.turn.vars['界双雄/color']).toBeUndefined();
  });

  // ─── B6. transformThenUse:弃黑色→红色手牌当决斗 → P2 扣血 ────────

  it('transformThenUse:发动双雄(弃黑色)后,红色手牌当决斗 → P2 不出杀扣1血', async () => {
    // 模拟双雄已发动:turn.vars['界双雄/color']='黑'
    // P1 手牌:c1(♥闪,红色,异色可转化)
    // P2 无杀 → 决斗中 P2 先被询问杀 → pass → P2 输 → 扣1血
    const c1 = makeCard('c1', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: ['c1'],
            skills: ['界双雄', '决斗'],
          }),
          makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '界双雄/color': '黑' } },
      }),
    );
    const P1 = harness.player('界颜良文丑');
    const P2 = harness.player('P2');
    const p2HealthBefore = harness.state.players[1].health;

    // 转化:c1(♥红色,与弃置黑色异色)当决斗。影子 id = c1#界双雄
    await P1.transformThenUse('界双雄', { cardId: 'c1' }, '决斗', {
      cardId: 'c1#界双雄',
      targets: [1],
    });

    // 影子卡已建立:名为"决斗"
    expect(harness.state.cardMap['c1#界双雄']).toBeDefined();
    expect(harness.state.cardMap['c1#界双雄'].name).toBe('决斗');
    // 原卡从手牌移除(被影子卡替换)
    expect(harness.state.players[0].hand).not.toContain('c1');

    // 无懈可击窗口(broadcast)→ pass
    await P1.pass();
    // P2 被询问出杀(决斗目标先出杀)
    P2.expectPending('询问杀');
    await P2.pass(); // P2 无杀 → 输

    // P2 扣1血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 影子决斗入弃牌堆时还原为原卡(shadowOf=c1),故弃牌堆含 c1
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.processing).toHaveLength(0);
  });

  // ─── B7. 负面:同色手牌 → 拒绝 ────────────────────────────────

  it('transform:颜色相同(弃置黑色,出♠黑色牌)→ 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2'); // ♠ 黑色
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: ['c1'],
            skills: ['界双雄', '决斗'],
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '界双雄/color': '黑' } },
      }),
    );
    const P1 = harness.player('界颜良文丑');

    await P1.expectRejected({
      skillId: '界双雄',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });

    // 状态未变:原卡仍在手牌,无影子卡
    expect(harness.state.cardMap['c1#界双雄']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── B8. 负面:未发动双雄(无颜色) → 拒绝 ────────────────────────

  it('transform:未发动双雄(turn.vars 无颜色)→ 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: ['c1'],
            skills: ['界双雄', '决斗'],
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} }, // 未发动双雄
      }),
    );
    const P1 = harness.player('界颜良文丑');

    await P1.expectRejected({
      skillId: '界双雄',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });

    expect(harness.state.cardMap['c1#界双雄']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── B9. availableActions:transform + respond 声明 ──────────────

  it('availableActions:界双雄 transform + respond 声明', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: ['c1'],
            skills: ['界双雄', '决斗'],
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '界双雄/color': '黑' } },
      }),
    );
    const P1 = harness.player('界颜良文丑');
    await P1.loadFrontend();

    const actions = P1.availableActions();
    const transform = actions.find((a) => a.skillId === '界双雄' && a.actionType === 'transform');
    expect(transform).toBeDefined();
    expect(transform?.label).toBe('双雄');
    expect(transform?.prompt.type).toBe('useCardAndTarget');
    expect(typeof transform?.activeWhen).toBe('function');
  });

  // ─── C10. 造成伤害 after-hook:杀对界颜良文丑造成伤害 → 记 cardId ─

  it('造成伤害:杀对界颜良文丑造成伤害 → cardId 加入 damageCards', async () => {
    const s1 = makeCard('s1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: [],
            skills: ['界双雄'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }),
        ],
        cardMap: { s1 },
        currentPlayerIndex: 0, // 界颜良文丑的回合(P2 用杀反击/决斗等都可能)
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 模拟:P2 对界颜良文丑造成 1 点伤害(用 s1 杀)
    await runDamageFlow(harness.state, 1, 0, 1, 's1');

    // damageCards 含 s1
    expect(harness.state.turn.vars['界双雄/damageCards']).toEqual(['s1']);
    // 界颜良文丑扣血
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── C11. 多次伤害 → 多张牌记录(去重) ─────────────────────────

  it('造成伤害:多次伤害(不同牌)→ 多张牌记录;同张牌去重', async () => {
    const s1 = makeCard('s1', '杀', '♠', '7');
    const j1 = makeCard('j1', '决斗', '♦', 'A', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: [],
            skills: ['界双雄'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { s1, j1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // s1 杀造成伤害
    await runDamageFlow(harness.state, 1, 0, 1, 's1');
    // j1 决斗造成伤害
    await runDamageFlow(harness.state, 1, 0, 1, 'j1');
    // s1 再次伤害(理论上同一张牌可能多次造伤,如多次结算)→ 去重
    await runDamageFlow(harness.state, 1, 0, 1, 's1');

    expect(harness.state.turn.vars['界双雄/damageCards']).toEqual(['s1', 'j1']);
  });

  // ─── D12. 结束阶段:获得本回合伤害牌(弃牌堆→手牌) ───────────

  it('结束阶段:获得本回合伤害牌(弃牌堆→手牌)', async () => {
    const s1 = makeCard('s1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: [],
            skills: ['界双雄'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: { s1 },
        // s1 已在弃牌堆(伤害结算后入弃牌堆)
        zones: { deck: [], discardPile: ['s1'], processing: [] },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: {
          round: 1,
          phase: '回合结束',
          vars: { '界双雄/damageCards': ['s1'] },
        },
      }),
    );

    // 触发结束阶段
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    // s1 从弃牌堆移到界颜良文丑手牌
    expect(harness.state.players[0].hand).toContain('s1');
    expect(harness.state.zones.discardPile).not.toContain('s1');
    // damageCards 已清理
    expect(harness.state.turn.vars['界双雄/damageCards']).toBeUndefined();
  });

  // ─── D13. 结束阶段:无伤害牌 → 无操作 ──────────────────────────

  it('结束阶段:无伤害牌 → 无操作(手牌不变)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: [],
            skills: ['界双雄'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} }, // 无 damageCards
      }),
    );

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    // 手牌仍为空
    expect(harness.state.players[0].hand).toHaveLength(0);
  });

  // ─── D14. 结束阶段:伤害牌已被其他技能拿走(不在弃牌堆)→ 跳过 ──

  it('结束阶段:伤害牌不在弃牌堆(被其他技能拿走)→ 跳过,不强行获取', async () => {
    const s1 = makeCard('s1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: [],
            skills: ['界双雄'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }), // s1 在 P2 手中
        ],
        cardMap: { s1 },
        zones: { deck: [], discardPile: [], processing: [] }, // s1 不在弃牌堆
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: {
          round: 1,
          phase: '回合结束',
          vars: { '界双雄/damageCards': ['s1'] },
        },
      }),
    );

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    // s1 仍在 P2 手牌,未被错误移动
    expect(harness.state.players[1].hand).toContain('s1');
    expect(harness.state.players[0].hand).not.toContain('s1');
  });

  // ─── E15. 转化卡(影子卡)造成伤害:记录原卡 id,结束阶段获得原卡 ─

  it('转化卡造成伤害:记录 shadowOf 原卡 id;结束阶段获得原卡(非影子卡)', async () => {
    // 模拟:武圣红牌当杀(影子卡 ws#武圣,name=杀,shadowOf=ws)对界颜良文丑造成伤害
    // 造成伤害 atom 的 cardId 是影子卡 id(ws#武圣)
    // 界双雄 hook 记录 shadowOf=ws(原卡 id)
    // 结束阶段:ws(原卡)在弃牌堆(影子入弃牌堆时引擎用原卡替换)→ 获得原卡 ws
    const ws = makeCard('ws', '闪', '♥', '2'); // 原卡(红色,可被武圣转化)
    const shadow: Card = {
      id: 'ws#武圣',
      name: '杀',
      suit: '♥',
      color: '红',
      rank: '2',
      type: '基本牌',
      shadowOf: 'ws',
    };
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界颜良文丑',
            hand: [],
            skills: ['界双雄'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['武圣'] }),
        ],
        cardMap: { ws, 'ws#武圣': shadow },
        // 武圣杀造成伤害后,影子入弃牌堆→引擎还原为原卡 ws;故弃牌堆含 ws(原卡)
        zones: { deck: [], discardPile: ['ws'], processing: [] },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );

    // 先模拟伤害事件(cardId = 影子卡 id ws#武圣)
    await runDamageFlow(harness.state, 1, 0, 1, 'ws#武圣');
    // hook 应记录 effectiveId = shadowOf = 'ws'(原卡 id)
    expect(harness.state.turn.vars['界双雄/damageCards']).toEqual(['ws']);

    // 触发结束阶段
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    // 原卡 ws 从弃牌堆移到界颜良文丑手牌
    expect(harness.state.players[0].hand).toContain('ws');
    expect(harness.state.zones.discardPile).not.toContain('ws');
  });
});
