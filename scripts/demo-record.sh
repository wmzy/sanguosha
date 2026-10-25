#!/usr/bin/env bash
# scripts/demo-record.sh — 一键：启动 5 AI 交互对局 → 启动录制舞台 → 录屏 → 合成 mp4。
#
# 用法: ./scripts/demo-record.sh [SECONDS]
#   SECONDS 默认 120（不含片头片尾）
#
# 环境变量:
#   SGS_KEEP=0      录制结束后关闭 tmux 与舞台（默认 1：保留对局，方便接着演示）
#   SGS_MODEL       同 demo-ai-match.sh（默认当前 provider 的 deepseek-flash）
#   SGS_OUT         成品路径（默认 data/demo-video/sanguosha-ai-demo.mp4）
#   SGS_AUDIO=0     关闭游戏音效采集（默认开启,从 PulseAudio monitor 抓取）
#   SGS_TRIM_START  裁掉录制开头的加载秒数（默认 4）
set -uo pipefail
SECONDS_TO_RECORD="${1:-120}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
SERVER_URL="http://localhost:3930"
STAGE_PORT="${SGS_STAGE_PORT:-3941}"
LOG_DIR="$PROJECT_DIR/data/demo-logs/record-latest"
OUT_DIR="$PROJECT_DIR/data/demo-video"
FINAL="${SGS_OUT:-$OUT_DIR/sanguosha-ai-demo.mp4}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

curl -sf --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" >/dev/null || {
  log "❌ 游戏服务器不可用，请先运行 pnpm dev"
  exit 1
}

# 录制账号：不存在则注册（demo/demo12345）。
if ! curl -sf --max-time 5 -X POST "$SERVER_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"username":"demo","password":"demo12345"}' >/dev/null; then
  curl -s --max-time 5 -X POST "$SERVER_URL/api/auth/register" \
    -H 'Content-Type: application/json' -d '{"username":"demo","password":"demo12345"}' >/dev/null || true
fi

# 清理上一轮录制编排（只清理本脚本启动的 tmux / 舞台）。
tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^sgs-ai-' | while read -r s; do
  tmux kill-session -t "$s" 2>/dev/null || true
done
pkill -f 'scripts/demo-stage.mjs' 2>/dev/null || true
rm -rf "$LOG_DIR"
mkdir -p "$OUT_DIR"

log "启动 5 个独立 omp 进程（interactive）..."
SGS_LOG_DIR="$LOG_DIR" nohup bash scripts/demo-ai-match.sh 5 interactive \
  > "$LOG_DIR.orchestrator.log" 2>&1 &
ORCH_PID=$!
# 等房间码与 tmux 会话就绪
DEADLINE=$(( $(date +%s) + 120 ))
ROOM=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ROOM=$(cat "$LOG_DIR/room-id.txt" 2>/dev/null || true)
  [ -n "$ROOM" ] && break
  sleep 2
done
if [ -z "$ROOM" ]; then
  log "❌ 等待建房超时，查看 $LOG_DIR.orchestrator.log"
  exit 2
fi
SESSION=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^sgs-ai-' | head -1)
log "房间 $ROOM，tmux 会话 $SESSION"

# 等 5 名 AI 全部加入并开局（minPlayers=5 由房主控制）。
DEADLINE=$(( $(date +%s) + 120 ))
PLAYING=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ST=$(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" \
    | python3 -c "
import sys,json
try: data=json.load(sys.stdin)
except Exception: sys.exit()
for r in data:
  if r.get('id')=='$ROOM': print(r.get('status',''))
" 2>/dev/null || true)
  if [ "$ST" = "进行中" ]; then PLAYING=1; break; fi
  sleep 3
done
if [ "$PLAYING" != "1" ]; then
  log "⚠️ 未等到开局，继续录制（可能还在大厅）"
fi

log "启动录制舞台 :$STAGE_PORT ..."
nohup node scripts/demo-stage.mjs \
  --room="$ROOM" --session="$SESSION" --port="$STAGE_PORT" \
  > "$LOG_DIR/stage.log" 2>&1 &
STAGE_PID=$!
sleep 2

log "开始录制 ${SECONDS_TO_RECORD}s ..."
AUDIO_ARG=""
[ "${SGS_AUDIO:-1}" = "0" ] && AUDIO_ARG="--audio=0"
node scripts/record-demo.mjs \
  --stage="http://localhost:$STAGE_PORT/" \
  --seconds="$SECONDS_TO_RECORD" \
  $AUDIO_ARG \
  --out="$OUT_DIR/raw-latest" 2>&1 | tee "$LOG_DIR/record.log"
RAW=$(ls -t "$OUT_DIR"/raw-latest/raw-*.webm 2>/dev/null | head -1)
AUDIO=$(ls -t "$OUT_DIR"/raw-latest/audio-*.wav 2>/dev/null | head -1 || true)
if [ -z "$RAW" ]; then
  log "❌ 未生成原始视频"
  exit 3
fi
log "合成最终视频 ... (${AUDIO:-无音效})"
TRIM_START="${SGS_TRIM_START:-4}" bash scripts/compose-demo-video.sh "$RAW" "$FINAL" "$AUDIO" | tee -a "$LOG_DIR/record.log"
log "✅ 成品: $FINAL"

if [ "${SGS_KEEP:-1}" = "0" ]; then
  kill "$STAGE_PID" 2>/dev/null || true
  [ -n "$SESSION" ] && tmux kill-session -t "$SESSION" 2>/dev/null || true
  kill "$ORCH_PID" 2>/dev/null || true
  log "已清理录制进程（SGS_KEEP=0）"
else
  log "已保留对局与舞台：tmux attach -t $SESSION ; 舞台 http://localhost:$STAGE_PORT/"
fi
