import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.ARENA_ORIGIN ?? 'http://127.0.0.1:3930';
const list = await (await fetch(`${origin}/api/arena`)).json();
const matchId = process.argv[2] ?? list.matches.find(m => m.players.length === 5 && m.status === 'completed')?.id;
if (!matchId) throw new Error('先运行一场 arena 对局，或传入 matchId');
const detail = await (await fetch(`${origin}/api/arena/${matchId}`)).json();
if (!detail.audience) throw new Error('对局暂无观众帧');
const executablePath = process.env.CHROME_PATH ?? (process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const dir = resolve('data/arena/design');
mkdirSync(dir, { recursive: true });
const results = [];
const errors = [];
async function verifySeats(page, view) {
  for (const player of view.players) {
    const actual = await page.getByTestId(`arena-hand-${player.index}`).locator('[data-arena-card]').count();
    assert.equal(actual, player.hand?.length ?? 0, `P${player.index + 1} 全手牌数量`);
    const identity = player.identity === '主公' || !player.alive ? player.identity ?? '暗' : '暗';
    assert.equal(await page.getByTestId(`arena-identity-${player.index}`).innerText(), identity);
  }
  const geometry = await page.getByTestId('arena-board').evaluate(board => {
    const b = board.getBoundingClientRect();
    const seats = [...board.querySelectorAll('.arena-seat')].map(node => node.getBoundingClientRect());
    return { inside: seats.every(s => s.left >= b.left - 1 && s.top >= b.top - 1 && s.right <= b.right + 1 && s.bottom <= b.bottom + 1),
      overlaps: seats.flatMap((a, i) => seats.slice(i + 1).filter(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) .length };
  });
  assert.ok(geometry.inside, '所有座位在牌桌内');
  assert.equal(geometry.overlaps, 0, '座位互不遮挡');
}
async function openPage(payload, width = 1600, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('ErrorBoundary')) errors.push(message.text()); });
  if (payload) await page.route(`**/api/arena/${matchId}`, route => route.fulfill({ json: payload }));
  await page.goto(`${origin}/arena/${matchId}`);
  await page.getByTestId('arena-board').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="arena-board"]')?.dataset.assetsReady === 'true');
  await page.locator('.arena-portrait img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  await verifySeats(page, payload?.audience.view ?? detail.audience.view);
  return page;
}
try {
  const page = await openPage();
  await page.screenshot({ path: resolve(dir, 'arena-five-final.png') });
  await page.getByRole('button', { name: '公共发言', exact: true }).click();
  await page.getByTestId('arena-public-chat').waitFor();
  await page.getByRole('button', { name: '关闭侧栏' }).click();
  await page.getByRole('button', { name: '战报', exact: true }).click();
  await page.getByTestId('arena-log').waitFor();
  await page.getByRole('button', { name: '关闭侧栏' }).click();
  await page.getByRole('button', { name: '对局归档', exact: true }).click();
  await page.getByTestId(`arena-match-${matchId}`).waitFor();
  await page.getByRole('button', { name: '关闭侧栏' }).click();
  await page.getByRole('button', { name: '纯净观战' }).click();
  assert.ok(await page.getByTestId('arena-page').evaluate(node => node.classList.contains('arena-clean')));
  await page.getByRole('button', { name: '恢复界面' }).click();
  results.push({ name: '真实归档/五席/身份/侧栏/纯净观战', passed: true });
  await page.close();

  // 取真实已归档的中局帧，只在浏览器拦截公开 API，不改存档、不伪称新实局。
  const historyPath = resolve('data/arena', matchId, 'audience.jsonl');
  const history = existsSync(historyPath) ? readFileSync(historyPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [detail.audience];
  const live = history.find(frame => frame.view.players.every(p => p.character && p.alive && p.hand?.length >= 3) && frame.view.zones?.processing.length) ?? history.find(frame => frame.view.players.every(p => p.character && p.alive && p.hand?.length >= 3)) ?? detail.audience;
  const livePayload = { ...detail, manifest: { ...detail.manifest, status: 'playing', name: '群雄逐鹿 · 五人身份场' }, audience: live };
  const livePage = await openPage(livePayload);
  await livePage.screenshot({ path: resolve(dir, 'arena-five-live.png') });
  const portraitCount = await livePage.locator('.arena-portrait img').count();
  assert.equal(portraitCount, live.view.players.length, '每席已装载武将立绘');
  for (const img of await livePage.locator('.arena-hand .arena-card img').all()) assert.ok(await img.evaluate(i => i.complete && i.naturalWidth > 0), '手牌图加载');
  results.push({ name: '真实中局帧/立绘/卡面', passed: true, seq: live.seq });
  await livePage.close();

  // 八席与超长手牌为布局 fixture，用于覆盖边界，不是八 AI 实战证明。
  const eight = structuredClone(livePayload);
  eight.manifest.name = '八人牌桌 · 布局验收';
  const view = eight.audience.view;
  const originals = structuredClone(view.players);
  view.players = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(originals[i % originals.length]), index: i, name: `AI ${i + 1}`, alive: i !== 7, identity: i === 0 ? '主公' : i === 7 ? '忠臣' : '反贼', identityHidden: i > 0 && i !== 7 }));
  const cards = Object.values(view.cardMap).filter(c => c.name === '杀' || c.name === '闪' || c.name === '桃');
  view.players[0].hand = Array.from({ length: 18 }, (_, i) => ({ ...cards[i % cards.length], id: `long-hand-${i}` }));
  view.players[0].handCount = 18;
  for (const [width, height] of [[1600, 900], [1366, 768], [900, 600], [390, 844]]) {
    const p = await openPage(eight, width, height);
    if (width === 390) { const hint = p.getByRole('button', { name: '关闭提示' }); if (await hint.isVisible()) await hint.click(); }
    await p.getByTestId('arena-player-0').getByRole('button', { name: '展开 ↗' }).click();
    await p.locator('dialog[open]').waitFor();
    assert.equal(await p.locator('dialog [data-arena-card]').count(), 18);
    await p.getByRole('button', { name: '关闭手牌' }).click();
    await p.screenshot({ path: resolve(dir, `arena-eight-${width}.png`) });
    results.push({ name: `八席/${width}×${height}/18张手牌展开/身份`, passed: true });
    await p.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  writeFileSync(resolve(dir, 'browser-results.json'), JSON.stringify({ matchId, results, errors }, null, 2));
  console.log(JSON.stringify({ matchId, results, screenshots: dir }, null, 2));
} finally { await browser.close(); }
