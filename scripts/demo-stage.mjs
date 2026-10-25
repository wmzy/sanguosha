// scripts/demo-stage.mjs — 演示录制舞台。
//
// 上半屏：游戏旁观页（iframe，?spectate=1）；下半屏：5 个 AI 的终端实况
// （直接 capture tmux 窗格，500ms 刷新）。
//
// 用法:
//   node scripts/demo-stage.mjs --room=ABC123 --session=sgs-ai-xxx [--port=3941]
//
// 录制时用 Playwright 打开 http://localhost:3941/ 即可同时拍到游戏与终端。
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  }),
);
const ROOM = args.get('room');
const SESSION = args.get('session');
const PORT = Number(args.get('port') ?? 3941);
const GAME_ORIGIN = args.get('game') ?? 'http://localhost:3930';
// tmux 窗格标题会被 omp TUI 覆写，用显式名单按窗格顺序命名。
const NAMES = (args.get('names') ?? 'AI-主公,AI-忠臣,AI-反贼,AI-内奸,AI-群雄')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!ROOM || !SESSION) {
  console.error('用法: node scripts/demo-stage.mjs --room=ABC123 --session=sgs-ai-xxx');
  process.exit(1);
}

/** 列出 tmux 窗格标题。 */
function paneTitles() {
  try {
    const out = execFileSync(
      'tmux',
      ['list-panes', '-t', SESSION, '-F', '#{pane_index}\t#{pane_title}'],
      { encoding: 'utf8' },
    );
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [index, ...title] = line.split('\t');
        return {
          index: Number(index),
          title: NAMES[Number(index)] ?? title.join('\t') ?? `pane ${index}`,
        };
      });
  } catch {
    return [];
  }
}

/** 抓取一个窗格的纯文本（tmux 已把 ANSI 光标定位铺平成屏幕内容）。 */
function capturePane(index, lines = 24) {
  try {
    const text = execFileSync(
      'tmux',
      ['capture-pane', '-p', '-t', `${SESSION}:0.${index}`, '-S', `-${lines}`],
      { encoding: 'utf8' },
    );
    return text.replace(/\s+$/u, '');
  } catch (e) {
    return `(无法读取终端: ${e instanceof Error ? e.message : String(e)})`;
  }
}

function renderWallJson() {
  return paneTitles().map((p) => ({ title: p.title, index: p.index, text: capturePane(p.index) }));
}

const stageHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>三国杀 AI 多智能体演示</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #05070d; color: #e8e6df;
    font-family: 'Noto Sans CJK SC', 'Noto Sans SC', system-ui, sans-serif; overflow: hidden; }
  #stage { display: flex; flex-direction: column; height: 100vh; }
  #topbar { height: 44px; flex: 0 0 44px; display: flex; align-items: center; gap: 14px;
    padding: 0 18px; background: linear-gradient(90deg, #151a28, #0a0d16);
    border-bottom: 1px solid rgba(241,196,15,.25); }
  #title { font-size: 16px; font-weight: 700; letter-spacing: 2px;
    background: linear-gradient(180deg,#ffe9a8,#f1c40f 60%,#c9a227);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .pill { font-size: 11px; padding: 3px 9px; border-radius: 999px;
    border: 1px solid rgba(180,140,242,.45); color: #cbb2ff; background: rgba(180,140,242,.08); }
  .pill.green { border-color: rgba(80,200,140,.4); color: #8ee6b8; background: rgba(80,200,140,.08); }
  #room { margin-left: auto; font-family: 'Noto Sans Mono CJK SC', monospace; font-size: 12px;
    color: #9aa4ba; letter-spacing: 1px; }
  #gamewrap { flex: 1 1 auto; min-height: 0; position: relative; background: #080b12; }
  #game { width: 100%; height: 100%; border: 0; display: block; }
  #wall { flex: 0 0 286px; display: grid; grid-template-columns: repeat(5, 1fr);
    gap: 6px; padding: 8px 10px 10px; background: #04060a;
    border-top: 1px solid rgba(241,196,15,.22); overflow: hidden; }
  .pane { background: #0a0e16; border: 1px solid #1d2638; border-radius: 7px;
    display: flex; flex-direction: column; min-width: 0; overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.03); }
  .pane-head { flex: 0 0 24px; display: flex; align-items: center; gap: 6px; padding: 0 8px;
    font-size: 11px; font-weight: 700; color: #f1d489; background: #101726;
    border-bottom: 1px solid #1d2638; letter-spacing: .5px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #5ad18a;
    box-shadow: 0 0 8px rgba(90,209,138,.8); }
  .pane pre { margin: 0; padding: 6px 8px; flex: 1 1 auto; overflow: hidden;
    font-family: 'Noto Sans Mono CJK SC', 'Noto Sans Mono', monospace; font-size: 10.5px;
    line-height: 1.42; color: #cfd6e6; white-space: pre-wrap; word-break: break-all; }
  .pane pre .tool { color: #f1c40f; }
  .pane pre .ok { color: #5ad18a; }
  .pane pre .err { color: #ff7b72; }
  .pane pre .dim { color: #6b748b; }
  #toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
    font-size: 12px; color: #9aa4ba; background: rgba(5,7,13,.82);
    border: 1px solid #1d2638; border-radius: 999px; padding: 5px 14px; }
</style></head>
<body>
<div id="stage">
  <div id="topbar">
    <div id="title">三国杀 · AI 多智能体实时对局</div>
    <span class="pill">5 × omp 进程</span>
    <span class="pill green">MCP 独立连接</span>
    <span id="room">ROOM ${ROOM}</span>
  </div>
  <div id="gamewrap"><iframe id="game" src="${GAME_ORIGIN}/play/${ROOM}?spectate=1" allow="autoplay"></iframe></div>
  <div id="wall"></div>
</div>
<div id="toast">终端实况：每个窗格 = 一个独立 omp 进程（独立 MCP 连接 / 独立账号）</div>
<script>
const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function colorize(line) {
  let h = esc(line);
  if (/error|失败|❌|拒绝|rejected/i.test(line)) return '<span class="err">' + h + '</span>';
  if (/gameOver|对局结束|胜方|accepted|✅/.test(line)) return '<span class="ok">' + h + '</span>';
  if (/play|createRoom|joinRoom|mcp__|tool|工具/i.test(line)) return '<span class="tool">' + h + '</span>';
  if (/^\\s*$/.test(line)) return '<span class="dim"> </span>';
  return h;
}
async function tick() {
  try {
    const panes = await (await fetch('/panes')).json();
    const wall = document.getElementById('wall');
    if (wall.dataset.n !== String(panes.length)) {
      wall.dataset.n = String(panes.length);
      wall.innerHTML = panes.map((p, i) =>
        '<div class="pane"><div class="pane-head"><span class="dot"></span>' + esc(p.title) + '</div><pre id="p' + i + '"></pre></div>'
      ).join('');
    }
    panes.forEach((p, i) => {
      const pre = document.getElementById('p' + i);
      if (!pre) return;
      const lines = p.text.split('\\n').slice(-19);
      pre.innerHTML = lines.map(colorize).join('\\n');
    });
  } catch (e) {
    document.getElementById('wall').textContent = '终端读取失败: ' + e;
  }
  setTimeout(tick, 500);
}
tick();
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === '/panes') {
    const body = JSON.stringify(renderWallJson());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(stageHtml);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-stage] http://localhost:${PORT}/  room=${ROOM} session=${SESSION}`);
});
