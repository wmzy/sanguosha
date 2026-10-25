// scripts/record-demo.mjs — 录制演示舞台（游戏画面 + 5 个 AI 终端）。
//
// 前置：
//   1. pnpm dev 已启动（3930）
//   2. npm run demo:ai 已启动 interactive 对局（tmux 会话）
//   3. node scripts/demo-stage.mjs --room=<ROOM> --session=<SESSION> --port=3941
//
// 用法：
//   node scripts/record-demo.mjs --stage=http://localhost:3941/ --seconds=150
//
// 输出：data/demo-video/raw-<timestamp>.webm + audio-<timestamp>.wav
//
// 音效：
//   - 默认从 PulseAudio monitor（auto_null.monitor）采集系统输出；
//   - 录制专用 Chromium 时移除 Playwright 默认的 --mute-audio；
//   - 通过 iframe 内可信点击解锁 AudioContext（见 useAudioUnlock）。
//   - --audio=0 关闭；--audio-device=<source> 指定其他 monitor。
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { copyFileSync, unlinkSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  }),
);
const STAGE = args.get('stage') ?? 'http://localhost:3941/';
const SECONDS = Number(args.get('seconds') ?? 150);
const OUT_DIR = resolve(args.get('out') ?? 'data/demo-video');
const GAME_ORIGIN = args.get('game') ?? 'http://localhost:3930';
const USERNAME = args.get('username') ?? 'demo';
const PASSWORD = args.get('password') ?? 'demo12345';
/** 音效录制:默认开启,从 PulseAudio monitor 抓取;--audio=0 可关闭。 */
const AUDIO_ENABLED = args.get('audio') !== '0';
const AUDIO_DEVICE =
  args.get('audio-device') ?? process.env.SGS_AUDIO_DEVICE ?? 'auto_null.monitor';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
mkdirSync(OUT_DIR, { recursive: true });

// 默认用 Playwright 自带 Chromium（比系统 Chrome 更稳定、可复现）；
// 需要换浏览器时设置 CHROME_PATH。
const executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  // Playwright 默认注入 --mute-audio;录制音效必须移除,否则 Chrome 不会把
  // Web Audio 输出送到 PulseAudio(sink monitor 里只有静音)。
  ignoreDefaultArgs: ['--mute-audio'],
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--font-render-hinting=none',
  ],
});

// 1) 登录（不录制）
const loginCtx = await browser.newContext();
const loginPage = await loginCtx.newPage();
await loginPage.goto(GAME_ORIGIN, { waitUntil: 'domcontentloaded' });
const login = await loginPage.evaluate(
  async ({ username, password }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  { username: USERNAME, password: PASSWORD },
);
if (login.status !== 200) {
  console.error('登录失败', login);
  await browser.close();
  process.exit(1);
}
// 录制时用 fast 动画（localStorage 属于 GAME_ORIGIN）。
await loginPage.evaluate(() => {
  try {
    localStorage.setItem('sgs_anim_speed', 'fast');
  } catch {
    /* ignore */
  }
});
const storage = await loginCtx.storageState();
await loginCtx.close();

// 2) 录制舞台 + 系统音效
const videoDir = mkdtempSync(join(tmpdir(), 'sgs-demo-video-'));
let audioProc = null;
let audioPath = null;
if (AUDIO_ENABLED) {
  audioPath = join(OUT_DIR, `audio-${STAMP}.wav`);
  // 与视频同时起步(视频从 newContext 开始计时);多录 60s 兜底,结束再 kill。
  audioProc = spawn(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-f', 'pulse', '-i', AUDIO_DEVICE,
      '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le',
      '-t', String(SECONDS + 60),
      audioPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  audioProc.stderr.on('data', (b) => console.log('[audio]', String(b).trim()));
  audioProc.on('error', (e) => console.log('[audio] 采集启动失败:', e.message));
  console.log(`[audio] 采集 ${AUDIO_DEVICE} -> ${audioPath}`);
}
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  storageState: storage,
  recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await page.goto(STAGE, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

// 等待游戏 iframe 进入旁观画面（最多 30s），确保视频不是空白。
const deadline = Date.now() + 30_000;
let ready = false;
let audioUnlocked = false;
while (Date.now() < deadline) {
  const frame = page.frames().find((f) => f.url().includes('/play/'));
  if (frame) {
    if (!audioUnlocked) {
      // AudioContext 需要可信用户手势解锁;body 点击在 capture 阶段被 useAudioUnlock 捕获。
      // 选棋盘中央(旁观只读,不会触发游戏动作),避免误点头部/手牌按钮。
      try {
        await frame.click('body', { position: { x: 960, y: 300 } });
        const unlocked = await frame.evaluate(async () => {
          const m = await import('/src/client/sounds/audioEngine.ts');
          return m.audioEngine.isUnlocked();
        });
        if (unlocked) {
          audioUnlocked = true;
          console.log('[audio] 已通过点击解锁游戏音频');
        }
      } catch {
        /* iframe 尚未可交互,下一轮重试 */
      }
    }
    const text = await frame.locator('body').innerText().catch(() => '');
    if (text.includes('旁观中')) {
      ready = true;
      break;
    }
  }
  await page.waitForTimeout(1000);
}
if (!ready) console.log('⚠️ 未检测到旁观画面，继续录制（可能仍在连接）');
await page.waitForTimeout(2500); // 等终端墙首次刷新
await page.screenshot({ path: join(OUT_DIR, 'poster.png'), type: 'png' }).catch(() => {});

const startedAt = Date.now();
console.log(`[record] 录制 ${SECONDS}s ...`);
let crashed = false;
try {
  await page.waitForTimeout(SECONDS * 1000);
} catch (e) {
  // 浏览器被外部关闭/崩溃：尽量把已录制的视频落盘，不直接丢弃。
  crashed = true;
  console.log('[record] ⚠️ 录制提前结束:', e instanceof Error ? e.message : String(e));
}
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
if (!crashed) {
  await page.screenshot({ path: join(OUT_DIR, 'last-frame.png'), type: 'png' }).catch(() => {});
}
// 停止音频采集(ffmpeg 收到 SIGTERM 会写完 WAV 头)。
if (audioProc && !audioProc.killed && audioProc.exitCode === null) {
  audioProc.kill('SIGTERM');
  await Promise.race([once(audioProc, 'exit'), new Promise((r) => setTimeout(r, 3000))]).catch(
    () => {},
  );
}
await ctx.close().catch(() => {});
await browser.close().catch(() => {});

// Playwright 在 context.close() 时落盘视频；找到最新的 webm。
const { readdirSync } = await import('node:fs');
const videos = readdirSync(videoDir)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => join(videoDir, f))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
if (videos.length === 0) {
  console.error('❌ 未生成视频文件');
  process.exit(1);
}
const out = join(OUT_DIR, `raw-${STAMP}.webm`);
copyFileSync(videos[videos.length - 1], out);
unlinkSync(videos[videos.length - 1]);
console.log(`[record] 完成 ${elapsed}s -> ${out}`);
if (audioPath && statSync(audioPath).size > 1024) {
  console.log(`[record] 音效 -> ${audioPath}`);
} else if (audioPath) {
  console.log('[record] ⚠️ 音效文件为空(可能无 PulseAudio monitor)');
}
