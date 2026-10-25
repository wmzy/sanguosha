#!/usr/bin/env bash
# scripts/demo-ai-match.sh — 启动一场「多个独立 omp 进程 + MCP」的 AI 互打。
#
# 每个玩家 = 一个独立 omp 进程 + 独立 MCP 连接 + 固定演示账号，
# 模拟真实多用户；所有实例统一使用当前 provider 的模型。
#
# 用法:
#   ./scripts/demo-ai-match.sh [PLAYER_COUNT] [MODE]
#     PLAYER_COUNT  2-8，默认 5
#     MODE          headless|interactive，默认 headless
#                    headless    = omp -p，日志落盘，供自动化/测试
#                    interactive = 5 个 tmux 窗格，供演示录制
#
# 环境变量:
#   SGS_SERVER_URL  游戏服务器（默认 http://localhost:3930）
#   SGS_MODEL       omp 模型（默认 ow/deepseek-v4-1-flash-261017）
#   SGS_LOG_DIR     日志目录（默认 data/demo-logs/<时间戳>）
#   SGS_ROOM_NAME   房间名（默认 AI 演示对局）
#   SGS_TIMEOUT_SEC 操作倒计时（默认 30；0=无限。演示建议 30：个别 agent 卡住也能推进）
#   SGS_MAX_TIME    单实例最长秒数（默认 1200）
#   SGS_BROWSER_URL 设置后自动打开旁观页（默认不打开）
#   SGS_AGENT_PASSWORD 演示账号密码（默认 sgs-demo-2026）
set -uo pipefail

COUNT="${1:-5}"
MODE="${2:-headless}"
SERVER_URL="${SGS_SERVER_URL:-http://localhost:3930}"
MODEL="${SGS_MODEL:-ow/deepseek-v4-1-flash-261017}"
ROOM_NAME="${SGS_ROOM_NAME:-AI 演示对局}"
TIMEOUT_SEC="${SGS_TIMEOUT_SEC:-30}"
MAX_TIME="${SGS_MAX_TIME:-1200}"
AGENT_PASSWORD="${SGS_AGENT_PASSWORD:-sgs-demo-2026}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date '+%m%d-%H%M%S')"
LOG_DIR="${SGS_LOG_DIR:-$PROJECT_DIR/data/demo-logs/$STAMP}"
OMP_BIN="${OMP:-omp}"
TSX_BIN="$PROJECT_DIR/node_modules/.bin/tsx"
MCP_ENTRY="$PROJECT_DIR/src/ai-mcp/server.ts"
TMUX_SESSION="sgs-ai-$STAMP"

mkdir -p "$LOG_DIR"
LOG_DIR="$(cd "$LOG_DIR" && pwd)"
echo "$LOG_DIR" > "$PROJECT_DIR/data/demo-logs/latest"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/orchestrator.log"; }

if ! curl -sf --max-time 3 "$SERVER_URL/api/rooms?type=multiplayer" >/dev/null; then
  log "❌ 游戏服务器不可用: $SERVER_URL（先运行 pnpm dev）"
  exit 1
fi
for bin in "$OMP_BIN" "$TSX_BIN"; do
  if [ ! -x "$bin" ] && ! command -v "$bin" >/dev/null; then
    log "❌ 找不到可执行文件: $bin"
    exit 1
  fi
done

cleanup_stale_room() {
  local ids
  ids=$(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" \
    | python3 -c "
import sys,json
try: data=json.load(sys.stdin)
except Exception: sys.exit()
for r in data:
  if r.get('name')=='$ROOM_NAME' and r.get('status')=='等待中':
    print(r['id'])
" 2>/dev/null || true)
  for id in $ids; do
    log "清理残留同名等待房间 $id"
    curl -s -X DELETE --max-time 5 "$SERVER_URL/api/rooms/$id" >/dev/null 2>&1 || true
  done
}
cleanup_stale_room

# 演示账号名同时作为显示名（服务端 displayName = 注册时原始 username）。
PLAYER_NAMES=("AI-主公" "AI-忠臣" "AI-反贼" "AI-内奸" "AI-群雄" "AI-六" "AI-七" "AI-八")

# 统一决策策略：推荐动作由 MCP 启发式评分器给出（message 已补齐 targets/cardIds），
# 直接原样回传即可，既快又避免 LLM 构造非法参数。
decision_rules() {
  cat <<'RULES'
决策规则（严格遵守）：
1. 启动工具调用成功后，循环调用 play（不传 action）等待，直到返回 needsAction=true 或 gameOver 非空。
2. needsAction=true 时：若 recommendedAction 非空，直接把 recommendedAction.message 作为下一次 play 的 action 原样提交；否则取 availableActions 第一条的 message 原样提交。
3. 提交后再次调用 play（不传 action）等待下一步，直到 gameOver 非空。
4. gameOver 非空时停止，不再调用工具，输出一行「对局结束：胜方=…，我是…」。
5. 每次 play 只提交一个动作；不要解释过程，不要并行调用多个 play，不要读源码，不要用 bash/curl。
6. availableActions 为空且 needsAction=false 时，继续 play 等待。
RULES
}

prepare_agent() {
  local i="$1" name="$2" prompt="$3"
  local dir="$LOG_DIR/agents/p$i"
  mkdir -p "$dir"
  cat > "$dir/.mcp.json" <<JSON
{
  "mcpServers": {
    "sanguosha": {
      "command": "$TSX_BIN",
      "args": ["$MCP_ENTRY"],
      "env": {
        "SGS_SERVER_URL": "$SERVER_URL",
        "SGS_MCP_USERNAME": "$name",
        "SGS_MCP_PASSWORD": "$AGENT_PASSWORD"
      },
      "timeout": 86400000
    }
  }
}
JSON
  printf '%s\n' "$prompt" > "$dir/prompt.md"
  # 禁用 Claude 插件 provider：本机已安装 sanguosha 插件，会同时暴露一套
  # 无演示账号的 MCP 工具（sanguosha-play:sanguosha），模型可能误选它导致
  # 「请先登录」。演示 agent 只使用本目录 .mcp.json 的独立连接。
  cat > "$dir/omp.yml" <<'YAML'
enabledProviders: []
YAML
  echo "$dir"
}

host_prompt() {
  cat <<PROMPT
你是三国杀 AI 房主，需要通过 MCP 工具驱动一个座次。
第一步：调用 createRoom 工具，参数 maxPlayers=$COUNT, minPlayers=$COUNT, playerId="${PLAYER_NAMES[0]}", name="$ROOM_NAME", timeoutSec=$TIMEOUT_SEC。
第二步：之后按下面规则循环。
$(decision_rules)
PROMPT
}

guest_prompt() {
  local name="$1" roomid="$2"
  cat <<PROMPT
你是三国杀 AI 玩家「$name」，需要通过 MCP 工具驱动一个座次。
第一步：调用 joinRoom 工具，参数 roomId="$roomid", playerId="$name", timeoutSec=$TIMEOUT_SEC。
第二步：之后按下面规则循环。
$(decision_rules)
PROMPT
}

wait_for_room() {
  local deadline=$(( $(date +%s) + 180 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local id
    id=$(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" \
      | python3 -c "
import sys,json
try: data=json.load(sys.stdin)
except Exception: sys.exit()
for r in data:
  if r.get('name')=='$ROOM_NAME' and r.get('hostId') and r.get('status')=='等待中':
    print(r['id']); break
" 2>/dev/null || true)
    if [ -n "$id" ]; then echo "$id"; return 0; fi
    sleep 2
  done
  return 1
}

spawn_headless() {
  local dir="$1" logname="$2"
  timeout "$MAX_TIME" "$OMP_BIN" \
    --model "$MODEL" --cwd "$dir" --config "$dir/omp.yml" --no-lsp --no-rules \
    --max-time "$((MAX_TIME - 20))" -p "@$dir/prompt.md" \
    > "$LOG_DIR/$logname.log" 2>&1 &
  echo $!
}

if [ "$MODE" = "interactive" ]; then
  if ! command -v tmux >/dev/null; then
    log "❌ interactive 模式需要 tmux"
    exit 1
  fi
  tmux new-session -d -s "$TMUX_SESSION" -x 240 -y 60 -c "$PROJECT_DIR"
  tmux set-option -t "$TMUX_SESSION" status-style "bg=#1a1f2e,fg=#f1c40f"
  tmux set-option -t "$TMUX_SESSION" pane-border-status top
  tmux set-option -t "$TMUX_SESSION" pane-border-format ' #{pane_title} '
fi

log "========== AI 互打启动 =========="
log "服务器=$SERVER_URL 玩家数=$COUNT 模型=$MODEL 模式=$MODE"
log "日志目录=$LOG_DIR"

# ── 房主 ──
HOST_DIR=$(prepare_agent 0 "${PLAYER_NAMES[0]}" "$(host_prompt)")
if [ "$MODE" = "interactive" ]; then
  tmux send-keys -t "$TMUX_SESSION:0.0" \
    "$OMP_BIN --model '$MODEL' --cwd '$HOST_DIR' --config '$HOST_DIR/omp.yml' --no-lsp --no-rules --auto-approve --max-time $MAX_TIME @'$HOST_DIR/prompt.md'" C-m
  HOST_PID=""
  tmux select-pane -t "$TMUX_SESSION:0.0" -T "${PLAYER_NAMES[0]} (host)"
else
  HOST_PID=$(spawn_headless "$HOST_DIR" "host-${PLAYER_NAMES[0]}")
  log "房主 pid=$HOST_PID，等待建房..."
fi

ROOM_ID=$(wait_for_room || true)
if [ -z "$ROOM_ID" ]; then
  log "❌ 等待建房超时"
  [ -n "$HOST_PID" ] && kill "$HOST_PID" 2>/dev/null
  exit 2
fi
log "✅ 房间码=$ROOM_ID"
echo "$ROOM_ID" > "$LOG_DIR/room-id.txt"
SPECTATE_URL="${SGS_BROWSER_URL:-http://localhost:3930}/play/$ROOM_ID?spectate=1"
echo "$SPECTATE_URL" > "$LOG_DIR/spectate-url.txt"
log "旁观地址: $SPECTATE_URL"
if [ -n "${SGS_BROWSER_URL:-}" ]; then
  xdg-open "$SPECTATE_URL" >/dev/null 2>&1 || true
fi

# ── 其余玩家 ──
PIDS=()
[ -n "$HOST_PID" ] && PIDS+=("$HOST_PID")
for ((i=1; i<COUNT; i++)); do
  name="${PLAYER_NAMES[$i]}"
  safe="${name//·/-}"
  dir=$(prepare_agent "$i" "$name" "$(guest_prompt "$name" "$ROOM_ID")")
  if [ "$MODE" = "interactive" ]; then
    tmux split-window -t "$TMUX_SESSION" -c "$PROJECT_DIR"
    tmux select-layout -t "$TMUX_SESSION" tiled >/dev/null
    pane=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_index}' | tail -1)
    tmux send-keys -t "$TMUX_SESSION:0.$pane" \
      "$OMP_BIN --model '$MODEL' --cwd '$dir' --config '$dir/omp.yml' --no-lsp --no-rules --auto-approve --max-time $MAX_TIME @'$dir/prompt.md'" C-m
    tmux select-pane -t "$TMUX_SESSION:0.$pane" -T "$name (guest)"
  else
    pid=$(spawn_headless "$dir" "guest-$safe")
    PIDS+=("$pid")
    log "启动 $name pid=$pid"
    sleep 1
  fi
done

if [ "$MODE" = "interactive" ]; then
  log "tmux 会话已就绪: tmux attach -t $TMUX_SESSION"
  log "提示: 全 5 个实例就绪后房主自动开局（minPlayers=$COUNT）"
  exit 0
fi

# ── 等待对局结束（房间消失或所有实例退出）──
DEADLINE=$(( $(date +%s) + MAX_TIME ))
ENDED=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  remaining=$(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" \
    | python3 -c "
import sys,json
try: data=json.load(sys.stdin)
except Exception: sys.exit()
print(sum(1 for r in data if r.get('id')=='$ROOM_ID'))
" 2>/dev/null || echo 1)
  alive=0
  for pid in "${PIDS[@]}"; do kill -0 "$pid" 2>/dev/null && alive=1; done
  if [ "$remaining" = "0" ]; then ENDED=1; break; fi
  if [ "$alive" = "0" ]; then ENDED=1; break; fi
  sleep 5
done

for pid in "${PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    log "⚠️ 强制结束仍存活的实例 pid=$pid"
    kill "$pid" 2>/dev/null || true
  fi
done
wait 2>/dev/null || true

if [ "$ENDED" = "1" ]; then
  log "✅ 对局结束（房间已结束/实例全部退出）"
else
  log "⚠️ 等待超时"
fi
log "实例日志: $LOG_DIR"
for f in "$LOG_DIR"/host-*.log "$LOG_DIR"/guest-*.log; do
  [ -f "$f" ] || continue
  log "--- $(basename "$f"): $(tail -n 1 "$f" | cut -c1-160)"
done
