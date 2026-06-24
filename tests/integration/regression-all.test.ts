// 用户报告的所有问题回归测试(烟雾测试)
//
// 目的:每个用户报告过的 bug 验证其核心场景仍然正常,作为 PR 合入前快速检查的回归契约。
// 注意:每个场景的完整覆盖在对应的 skill-tests/<技能名>.test.ts 中,
//       本文件不追求穷尽——只验证「核心链路通」即可。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build2p(opts?: { p0Hand?: string[]; p1Hand?: string[]; p0Skills?: string[]; p1Skills?: string[]; extraCards?: Record<string, Card> }): GameState {
  const cards: Record<string, Card> = {};
  const mk = (id: string, name: string, suit: Card['suit'] = '♠', rank = 'A', type: Card['type'] = '基本牌') => { cards[id] = { id, name, suit, rank, type }; return id; };
  const p0h = opts?.p0Hand ?? [mk('s0', '杀')];
  const p1h = opts?.p1Hand ?? [];
  if (opts?.extraCards) Object.assign(cards, opts.extraCards);
  for (const id of [...p0h, ...p1h]) { if (!cards[id]) cards[id] = { id, name: '杀', suit: '♠', rank: '7', type: '基本牌' }; }
  return createGameState({
    players: [
      { index: 0, name: 'P0', character: 'X', health: 4, maxHealth: 4, alive: true, hand: p0h, equipment: {}, skills: opts?.p0Skills ?? ['杀'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] },
      { index: 1, name: 'P1', character: 'Y', health: 4, maxHealth: 4, alive: true, hand: p1h, equipment: {}, skills: opts?.p1Skills ?? ['闪'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] },
    ],
    cardMap: cards, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
  });
}
const tick = () => new Promise(r => setTimeout(r, 50));

describe('用户报告问题回归', () => {
  let h: SkillTestHarness;
  beforeEach(() => { h = new SkillTestHarness(); });

  // 1. 杀的结算:处理区卡杀,没询问闪
  it('杀→询问闪→不出闪→扣血→处理区清空', async () => {
    await h.setup(build2p({ p1Skills: ['闪'] }));
    const P0 = h.player('P0'); const P1 = h.player('P1');
    await P0.useCardAndTarget('杀', 's0', [1]);
    P1.expectPending('询问闪');
    await P1.pass();
    expect(h.state.players[1].health).toBe(3);
    expect(h.state.zones.processing).toEqual([]);
  });

  // 2. 被询问闪时不能 respond 杀
  it('被询问闪时出杀被拒绝', async () => {
    const s2: Card = { id: 's2', name: '杀', suit: '♣', rank: '5', type: '基本牌' };
    await h.setup(build2p({ p1Hand: ['s2'], p1Skills: ['闪', '杀'], extraCards: { s2 } }));
    const P0 = h.player('P0'); const P1 = h.player('P1');
    await P0.useCardAndTarget('杀', 's0', [1]);
    P1.expectPending('询问闪');
    await P1.expectRejected({ skillId: '杀', actionType: 'respond', params: { cardId: 's2' } });
    expect(h.state.zones.processing).toEqual(['s0']);
  });

  // 3. 顺手牵羊可以使用
  it('顺手牵羊→拿P1手牌', async () => {
    const ssq: Card = { id: 'ssq', name: '顺手牵羊', suit: '♠', rank: '3', type: '锦囊牌' };
    const d1: Card = { id: 'd1', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
    await h.setup(build2p({ p0Hand: ['ssq'], p0Skills: ['顺手牵羊'], p1Hand: ['d1'], p1Skills: [], extraCards: { ssq, d1 } }));
    const P0 = h.player('P0'); const P1 = h.player('P1');
    await P0.useCardAndTarget('顺手牵羊', 'ssq', [1]);
    // 无懈 pass
    if (h.state.pendingSlots.size > 0) await P1.pass();
    // 盲选窗口:P0 选第 0 张
    await P0.respond('顺手牵羊', { zone: 'hand', handIndex: 0 });
    expect(h.state.players[0].hand).toContain('d1');
    expect(h.state.players[1].hand).not.toContain('d1');
  });

  // 4. 仁德可以使用
  it('仁德→给P1一张牌', async () => {
    const card: Card = { id: 'rd1', name: '杀', suit: '♠', rank: '5', type: '基本牌' };
    await h.setup(build2p({ p0Hand: ['rd1'], p0Skills: ['仁德'], extraCards: { rd1: card } }));
    const P0 = h.player('P0');
    await P0.triggerAction('仁德', 'use', { cardId: 'rd1', targets: [{ target: 1, cardIds: ['rd1'] }] });
    expect(h.state.players[1].hand).toContain('rd1');
    expect(h.state.players[0].hand).not.toContain('rd1');
  });

  // 5. 制衡可以使用
  it('制衡→弃1张摸1张', async () => {
    const card: Card = { id: 'zh1', name: '杀', suit: '♠', rank: '5', type: '基本牌' };
    await h.setup(build2p({ p0Hand: ['zh1'], p0Skills: ['制衡'], extraCards: { zh1: card } }));
    const P0 = h.player('P0');
    const handBefore = h.state.players[0].hand.length;
    await P0.triggerAction('制衡', 'use', { cardId: 'zh1' });
    expect(h.state.players[0].hand.length).toBe(handBefore); // -1弃 +1摸
  });

  // 6. 无中生有→无懈pass→摸2张
  it('无中生有→无懈pass→摸2张', async () => {
    const wsz: Card = { id: 'wsz', name: '无中生有', suit: '♥', rank: '3', type: '锦囊牌' };
    const filler: Card = { id: 'f0', name: '杀', suit: '♠', rank: '2', type: '基本牌' };
    await h.setup(build2p({ p0Hand: ['wsz', 'f0'], p0Skills: ['无中生有'], extraCards: { wsz, f0: filler } }));
    const P0 = h.player('P0'); const P1 = h.player('P1');
    const handBefore = h.state.players[0].hand.length;
    await P0.useCard('无中生有', 'wsz');
    // 无懈询问
    if (h.state.pendingSlots.size > 0) await P1.pass();
    expect(h.state.players[0].hand.length).toBe(handBefore - 1 + 2);
  });

  // 7. 反馈:受伤后 confirm → 拿来源牌
  it('反馈→受伤→confirm=true→拿来源手牌', async () => {
    const s2: Card = { id: 's2', name: '杀', suit: '♣', rank: '5', type: '基本牌' };
    const extra: Card = { id: 'ex1', name: '闪', suit: '♥', rank: '7', type: '基本牌' };
    await h.setup(build2p({ p0Hand: ['s0', 'ex1'], p0Skills: ['杀'], p1Skills: ['反馈', '闪'], extraCards: { ex1: extra } }));
    const P0 = h.player('P0'); const P1 = h.player('P1');
    await P0.useCardAndTarget('杀', 's0', [1]);
    await P1.pass(); // 不出闪→扣血
    expect(h.state.players[1].health).toBe(3);
    // 反馈 pending
    expect(h.state.pendingSlots.size).toBeGreaterThan(0);
    await P1.respond('反馈', { choice: true });
    // P1 应拿到 P0 的 ex1
    expect(h.state.players[1].hand).toContain('ex1');
    expect(h.state.players[0].hand).not.toContain('ex1');
  });

  // 8. 桃:非濒死出牌阶段给自己回血
  it('桃→出牌阶段给自己回1血', async () => {
    const peach: Card = { id: 'peach0', name: '桃', suit: '♥', rank: '5', type: '基本牌' };
    const s = build2p({ p0Hand: ['peach0'], p0Skills: ['桃'], extraCards: { peach0: peach } });
    s.players[0].health = 3; // 受伤状态
    await h.setup(s);
    const P0 = h.player('P0');
    await P0.triggerAction('桃', 'use', { cardId: 'peach0', targets: [0] });
    expect(h.state.players[0].health).toBe(4);
  });

  // 9. 借刀杀人:目标出杀杀第三方
  it('借刀杀人→目标出杀→第三方被询问闪', async () => {
    const jdsr: Card = { id: 'jdsr', name: '借刀杀人', suit: '♠', rank: 'Q', type: '锦囊牌' };
    const weapon: Card = { id: 'wp1', name: '诸葛连弩', suit: '♠', rank: 'A', type: '装备牌' };
    const slash2: Card = { id: 's2', name: '杀', suit: '♣', rank: '5', type: '基本牌' };
    const state3 = createGameState({
      players: [
        { index:0,name:'P0',character:'X',health:4,maxHealth:4,alive:true,hand:['jdsr'],equipment:{},skills:['借刀杀人'],vars:{},marks:[],pendingTricks:[],tags:[],judgeZone:[]},
        { index:1,name:'P1',character:'Y',health:4,maxHealth:4,alive:true,hand:['s2'],equipment:{'武器':'wp1'},skills:['杀','闪'],vars:{},marks:[],pendingTricks:[],tags:[],judgeZone:[]},
        { index:2,name:'P2',character:'Z',health:4,maxHealth:4,alive:true,hand:[],equipment:{},skills:['闪'],vars:{},marks:[],pendingTricks:[],tags:[],judgeZone:[]},
      ],
      cardMap: { jdsr, wp1: weapon, s2: slash2 },
      currentPlayerIndex:0,phase:'出牌',turn:{round:1,phase:'出牌',vars:{}},
    });
    await h.setup(state3);
    const P0 = h.player('P0'); const P1 = h.player('P1'); const P2 = h.player('P2');
    await P0.triggerAction('借刀杀人', 'use', { cardId: 'jdsr', target: 1, killTarget: 2 });
    // 无懈 pass
    if (h.state.pendingSlots.size > 0) await P0.pass();
    // 借刀杀人 forceKill 询问 P1
    if (h.state.pendingSlots.size > 0) {
      const info = P1.respondInfo();
      expect(info?.skillId).toBe('杀');
      await P1.respond('杀', { cardId: 's2' });
      await tick(); // 等 dispatch resolve + 借刀杀人 execute resume
    }
    // P2 被询问闪
    expect(h.state.pendingSlots.size).toBeGreaterThan(0);
    const slot2 = [...h.state.pendingSlots.values()][0];
    expect((slot2.atom as { type: string }).type).toBe('询问闪');
  });

  // 10. 无懈可击:锦囊询问
  it('过河拆桥→无懈可击询问出现', async () => {
    const ghq: Card = { id: 'ghq', name: '过河拆桥', suit: '♠', rank: '4', type: '锦囊牌' };
    const wx: Card = { id: 'wx', name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    await h.setup(build2p({ p0Hand: ['ghq'], p0Skills: ['过河拆桥'], p1Hand: ['wx'], p1Skills: ['无懈可击'], extraCards: { ghq, wx } }));
    const P0 = h.player('P0'); const P1 = h.player('P1');
    await P0.useCardAndTarget('过河拆桥', 'ghq', [1]);
    // 应该有无懈可击 pending
    expect(h.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...h.state.pendingSlots.values()][0];
    const atom = slot.atom as { type: string; requestType?: string };
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('无懈可击');
  });
});
