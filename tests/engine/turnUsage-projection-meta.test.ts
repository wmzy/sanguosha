// tests/engine/turnUsage-projection-meta.test.ts
// 来源:A2 view-projection desync 收口(review 建议,非单技能 bug)。
// 归并建议:横切引擎契约,不属于任何 skill-test,暂独立成文件。
//
// turnUsage 投影一致性 meta-test,测三层契约:
//   1. 静态 key 契约:所有 applyAtom('回合用量') 写入端的 key 表达式必须
//      经由 rules/vars-keys.ts 注册表(常量/工厂)或本文件局部约定
//      (`${SKILL_ID}/...` 模板);跨文件消费端(action-active/viewDistance)
//      不得再出现字面量 key 读取。拼错 key = view-projection desync,
//      运行期无任何报错,只能靠静态契约拦截。
//   2. view/state 谓词同源:按规范投影写法同步后,前端 view 谓词
//      (viewSlashMax/viewCanSlash/viewSlashUsed/viewSlashTargetMax)
//      必须与后端权威谓词(slashMax/canSlash/slashUsed/slashTargetMax)一致。
//      key 对但聚合逻辑不同步,同样 desync。
//   3. 端到端链路:真实 dispatch 出杀 → view.turnUsage 实时更新 →
//      回合结束清空(harness 的 assertViewConsistency 只验证两条 view
//      通道互相收敛,抓不到「state 变了但没人投影」——本文件补这个洞)。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Card, GameState, GameView, Json } from '../../src/engine/types';
import { createGameState, suitColor } from '../../src/engine/types';
import * as varsKeys from '../../src/engine/rules/vars-keys';
import {
  slashMax,
  slashUsed,
  canSlash,
  incSlashUsed,
  registerSlashUnlimitedProvider,
  registerSlashExtraProvider,
  registerSlashBlocker,
  registerSlashExemptor,
} from '../../src/engine/rules/slash-quota';
import {
  viewSlashMax,
  viewSlashUsed,
  viewCanSlash,
  viewSlashTargetMax,
} from '../../src/engine/rules/action-active';
import { slashTargetMax, registerSlashTargetProvider } from '../../src/engine/rules/slash-target';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';

// ─── 公共构造 ──────────────────────────────────────────────

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: { index: number; name: string; hand?: string[]; skills?: string[] }) {
  return {
    index: opts.index,
    name: opts.name,
    character: '测试',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeState(): GameState {
  const s1 = makeCard('s1', '杀', '♠', 'A');
  return createGameState({
    players: [makePlayer({ index: 0, name: 'P0', hand: ['s1'] }), makePlayer({ index: 1, name: 'P1' })],
    cardMap: { s1 },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 构造仅含 view 谓词所需字段的最小 GameView(谓词只读 players/cardMap/viewer)。 */
function makeView(turnUsage: Record<string, Json>, hand: Card[] = []): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    cardMap: {},
    players: [
      { name: 'P0', hand, turnUsage, equipment: {}, skills: [], distanceVars: {} },
      { name: 'P1', turnUsage: {}, equipment: {}, skills: [], distanceVars: {} },
    ],
  } as unknown as GameView;
}

// ─── Part 1:静态 key 契约 ─────────────────────────────────

describe('turnUsage 投影 key 静态契约', () => {
  const ENGINE_ROOT = resolve(__dirname, '../../src/engine');

  function walkTs(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walkTs(p));
      else if (name.endsWith('.ts')) out.push(p);
    }
    return out;
  }
  const files = walkTs(ENGINE_ROOT);

  // 注册表导出的常量名与工厂名(从模块对象反射,注册表新增导出自动纳入)
  const registryConsts = new Set(
    Object.keys(varsKeys).filter((k) => typeof (varsKeys as Record<string, unknown>)[k] !== 'function'),
  );
  const registryFns = new Set(
    Object.keys(varsKeys).filter((k) => k.endsWith('Key') && typeof (varsKeys as Record<string, unknown>)[k] === 'function'),
  );
  // 跨文件具名 view key 值(局部字面量 key 不得与之撞名)
  const registryKeyValues = new Set(
    Object.entries(varsKeys)
      .filter(([k, v]) => typeof v === 'string' && !k.endsWith('PREFIX') && !k.endsWith('SUFFIX'))
      .map(([, v]) => v as string),
  );
  const registryPrefixes = [varsKeys.SLASH_UNLIMITED_PREFIX, varsKeys.SLASH_EXTRA_PREFIX, varsKeys.SLASH_BLOCKED_PREFIX, varsKeys.SLASH_TARGET_PREFIX];

  /** 提取全部 applyAtom('回合用量') 写入点的 key 表达式 */
  function collectWriters(): { file: string; expr: string }[] {
    const hits: { file: string; expr: string }[] = [];
    const re = /type:\s*'回合用量'[\s\S]{0,300}?key:\s*([A-Za-z_$][\w$]*\([^)]*\)|`[^`]*`|'[^']*'|[A-Za-z_$][\w$]*)/g;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(re)) hits.push({ file: f.replace(ENGINE_ROOT + '/', ''), expr: m[1] });
    }
    return hits;
  }

  it('注册表导出常量值互不重复(两常量同值 = 消费端张冠李戴)', () => {
    const seen = new Map<string, string>();
    for (const [k, v] of Object.entries(varsKeys)) {
      if (typeof v !== 'string') continue;
      if (seen.has(v)) throw new Error(`vars-keys 常量值重复: ${seen.get(v)} 与 ${k} 均为 "${v}"`);
      seen.set(v, k);
    }
  });

  it('所有「回合用量」写入点 key 必须经注册表或局部技能名模板(禁止跨文件裸字面量)', () => {
    const writers = collectWriters();
    expect(writers.length).toBeGreaterThan(30); // 防提取正则失效后空转通过
    const violations: string[] = [];
    for (const { file, expr } of writers) {
      // atom/类型声明文件自身的 key: atom.key / key: string 形态,非技能写入点
      if (file === 'atoms/回合用量.ts' || file === 'types/atom.ts') continue;
      // 1) 工厂调用:slashXxxKey(...) / usedThisTurnKey(...)
      const call = expr.match(/^(\w+)\(/);
      if (call) {
        if (!registryFns.has(call[1])) violations.push(`${file}: key ${expr} 调用了非注册表工厂`);
        continue;
      }
      // 2) 标识符:注册表导出名(import 或 const 别名)直接放行;否则查本文件 const 定义
      const ident = expr.match(/^(\w+)$/);
      if (ident) {
        if (registryConsts.has(ident[1]) || registryFns.has(ident[1])) continue;
        const src = readFileSync(join(ENGINE_ROOT, file), 'utf8');
        const def = src.match(new RegExp(`const ${ident[1]} = ([^;\\n]+);`));
        if (!def) {
          violations.push(`${file}: key 标识符 ${ident[1]} 在文件内无 const 定义`);
          continue;
        }
        const val = def[1].trim();
        if (registryConsts.has(val)) continue; // 注册表常量别名
        // 工厂调用调用值(如 const SLASH_TARGET_TU = slashTargetKey('界巧说')):工厂已在 case 1 约束
        if (/^\w+\(/.test(val)) continue;
        const tpl = val.match(/^`\$\{(SKILL_ID|SKILL_NAME|DISPLAY_NAME)\}[^`]*`$/);
        if (tpl) continue; // 局部技能名前缀约定
        const lit = val.match(/^'([^']*)'$/);
        if (lit) {
          // 局部字面量 key:不得闯入跨文件命名空间('杀/' 前缀)或与具名注册 key 撞名
          if (registryPrefixes.some((p) => lit[1].startsWith(p)))
            violations.push(`${file}: 局部字面量 key '${lit[1]}' 使用了跨文件 '杀/' 前缀,必须走 vars-keys 注册表工厂`);
          else if (registryKeyValues.has(lit[1]))
            violations.push(`${file}: 局部字面量 key '${lit[1]}' 与注册表具名 key 撞名,必须 import 注册表常量`);
          continue;
        }
        violations.push(`${file}: const ${ident[1]} = ${val} 不是注册表常量/技能名模板/字面量`);
        continue;
      }
      // 3) 内联模板串:须以 ${SKILL_ID}/${SKILL_NAME}/${DISPLAY_NAME} 开头(局部约定)
      const tpl = expr.match(/^`\$\{(?:SKILL_ID|SKILL_NAME|DISPLAY_NAME)\}/);
      if (tpl) continue;
      // 4) 内联字面量:仅注册表文件本身允许
      const lit = expr.match(/^'([^']*)'$/);
      if (lit) {
        if (file.endsWith('rules/vars-keys.ts')) continue;
        violations.push(`${file}: key 裸字面量 '${lit[1]}'(跨文件 key 必须经 vars-keys 注册表)`);
        continue;
      }
      violations.push(`${file}: 无法识别的 key 表达式 ${expr}`);
    }
    expect(violations).toEqual([]);
  });

  it('跨文件消费端(action-active/viewDistance)不得出现字面量 key 读取', () => {
    const consumers = ['rules/action-active.ts', 'rules/viewDistance.ts'];
    const violations: string[] = [];
    for (const rel of consumers) {
      const src = readFileSync(join(ENGINE_ROOT, rel), 'utf8');
      // 代码读取形态:turnUsage?.['...'] / tu['...'](注释中的文档字符串不匹配此形态)
      for (const _m of src.matchAll(/turnUsage\?\.\[\s*'/g)) violations.push(`${rel}: turnUsage?.[ 字面量读取`);
      for (const _m of src.matchAll(/\btu\[\s*'/g)) violations.push(`${rel}: tu[ 字面量读取`);
      for (const _m of src.matchAll(/\.startsWith\(\s*'/g)) violations.push(`${rel}: startsWith 字面量前缀`);
    }
    expect(violations).toEqual([]);
  });
});

// ─── Part 2:view/state 谓词同源 ───────────────────────────

describe('turnUsage 投影后 view 谓词与后端权威谓词同源', () => {
  it('unlimited:注册表投影 → viewSlashMax=∞ 与 slashMax=∞ 一致', () => {
    const state = makeState();
    registerSlashUnlimitedProvider(state, 0, (_s, p) => p === 0);
    const view = makeView({ [varsKeys.slashUnlimitedKey('咆哮')]: true });
    expect(slashMax(state, 0)).toBe(Infinity);
    expect(viewSlashMax(view, 0)).toBe(Infinity);
  });

  it('extra:投影值=提供者贡献 → viewSlashMax 与 slashMax 一致(叠加)', () => {
    const state = makeState();
    registerSlashExtraProvider(state, 0, (_s, p) => (p === 0 ? 2 : 0));
    const view = makeView({ [varsKeys.slashExtraKey('天义')]: 2 });
    expect(slashMax(state, 0)).toBe(3);
    expect(viewSlashMax(view, 0)).toBe(3);
  });

  it('blocked:投影真值 → viewCanSlash=false 与 canSlash=false 一致', () => {
    const state = makeState();
    registerSlashBlocker(state, 0, (_s, p) => p === 0);
    const view = makeView({ [varsKeys.slashBlockedKey('天义')]: true });
    expect(canSlash(state, 0)).toBe(false);
    expect(viewCanSlash(view, 0)).toBe(false);
  });

  it('usedCount:投影值=slashUsed() 合计 → viewSlashUsed/viewCanSlash 一致', () => {
    const state = makeState();
    incSlashUsed(state);
    expect(slashUsed(state)).toBe(1);
    const view = makeView({ [varsKeys.SLASH_USED_COUNT_KEY]: 1 });
    expect(viewSlashUsed(view, 0)).toBe(1);
    expect(viewCanSlash(view, 0)).toBe(false); // 1/1 已达上限
    expect(canSlash(state, 0)).toBe(false);
  });

  it('exemptSuit:投影花色+手牌同花色杀 → viewCanSlash=true 与 canSlash(cardId)=true 一致', () => {
    const s2 = makeCard('s2', '杀', '♦', '2');
    const state = makeState();
    state.cardMap['s2'] = s2;
    registerSlashExemptor(state, 0, (_s, p, cardId) => p === 0 && cardId === 's2');
    const view = makeView({ [varsKeys.SLASH_EXEMPT_SUIT_KEY]: '♦' }, [s2]);
    expect(canSlash(state, 0, 's2')).toBe(true);
    expect(viewCanSlash(view, 0)).toBe(true);
  });

  it('target:投影值=目标数加成 → viewSlashTargetMax 与 slashTargetMax 一致', () => {
    const s1 = makeCard('s1', '杀', '♠', 'A');
    const state = makeState();
    registerSlashTargetProvider(state, 0, (_s, p, _c) => (p === 0 ? 2 : 1));
    const view = makeView({ [varsKeys.slashTargetKey('界巧说')]: 1 });
    expect(slashTargetMax(state, 0, 's1')).toBe(2);
    expect(viewSlashTargetMax(view, 0, s1)).toBe(2);
  });
});

// ─── Part 3:端到端投影链路 ────────────────────────────────

describe('回合用量投影端到端链路', () => {
  it('出杀 → view.turnUsage 实时同步 usedCount;回合结束 → 清空', async () => {
    const s1 = makeCard('s1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['回合管理', '杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理', '杀'] }),
      ],
      cardMap: { s1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    const harness = new SkillTestHarness();
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    expect(P0.view.players[0]?.turnUsage?.[varsKeys.SLASH_USED_COUNT_KEY]).toBeUndefined();

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();

    // state 权威值与 view 投影一致(desync 则此处失败)
    expect(slashUsed(harness.state)).toBe(1);
    expect(P0.view.players[0]?.turnUsage?.[varsKeys.SLASH_USED_COUNT_KEY]).toBe(1);
    expect(viewSlashUsed(P0.view, 0)).toBe(1);

    // 结束回合 → 下家回合开始后,本家 turnUsage 被整体清空
    // (tryDispatch 不推进 processedView,需手动广播——模拟真实连接的 handleMessage)
    await P0.tryDispatch({ skillId: '回合管理', actionType: 'end', params: {} });
    harness.processAllEvents();
    // P1 出牌阶段 → 结束回合,回到 P0
    await P1.tryDispatch({ skillId: '回合管理', actionType: 'end', params: {} });
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(0);
    expect(P0.view.players[0]?.turnUsage?.[varsKeys.SLASH_USED_COUNT_KEY]).toBeUndefined();
    expect(viewSlashUsed(P0.view, 0)).toBe(0);
    expect(slashUsed(harness.state)).toBe(0);
  });
});
