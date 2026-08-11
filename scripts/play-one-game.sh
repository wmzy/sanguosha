#!/usr/bin/env bash
# scripts/play-one-game.sh — 运行一局 5 人 AI 对局。
#
# 用法: ./scripts/play-one-game.sh <gameNumber>
#
# 流程:
#   1. wmzy(房主) createRoom(maxPlayers=5, timeoutSec=0)
#   2. 编排器轮询 REST 发现房间码
#   3. 4 个 guest joinRoom 加入同一房间
#   4. 5 个 omp 实例并行对局至 gameOver 后退出
#   5. 收集本局 bug 反馈到 data/game-logs/game-N/feedback/
#
# 环境:
#   SGS_SERVER_URL  游戏服务器地址 (默认 http://localhost:3940)
#   SGS_FEEDBACK_DIR bug 反馈落盘目录
#   OMP             omp 二进制路径 (默认 omp)
#   PROJECT_DIR     项目目录 (默认脚本所在仓库根)
#   PER_INSTANCE_TIMEOUT  单实例最长运行秒数 (默认 2400=40min)
set -euo pipefail

GAME_N="${1:?用法: $0 <gameNumber>}"
SERVER_URL="${SGS_SERVER_URL:-http://localhost:3940}"
OMP_BIN="${OMP:-omp}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ARENA_DIR="/home/zlt/projects/sanguosha-ai-arena"
PER_INSTANCE_TIMEOUT="${PER_INSTANCE_TIMEOUT:-2400}"

LOG_DIR="$PROJECT_DIR/data/game-logs/game-$GAME_N"
mkdir -p "$LOG_DIR/instances"

# 本局使用的房主玩家名 (带局号后缀, 避免与历史房间混淆)
HOST_NAME="wmzy"
ROOM_NAME="AI对局第${GAME_N}局"

# 反馈目录必须与项目 .mcp.json 中 SGS_FEEDBACK_DIR 一致 (MCP 写入位置)
FEEDBACK_DIR="$ARENA_DIR/data/ai-feedback"
mkdir -p "$FEEDBACK_DIR"

echo "[game-$GAME_N] 服务器=$SERVER_URL 反馈目录=$FEEDBACK_DIR"

cleanup_stale_room() {
  # 仅清理本编排器自己可能残留的同名房间 (AI对局第N局)。
  # 不按 hostId 清理, 避免误删用户手工创建的 wmzy 房间 (如 8AADSK)。
  local ids
  ids=$(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" \
        | python3 -c "
import sys,json
try:
  data=json.load(sys.stdin)
except: 
  print(''); sys.exit()
for r in data:
  if r.get('name')=='$ROOM_NAME':
    print(r['id'])
" 2>/dev/null || true)
  for id in $ids; do
    echo "[game-$GAME_N] 清理残留同名房间 $id"
    curl -s -X DELETE --max-time 5 "$SERVER_URL/api/rooms/$id" >/dev/null 2>&1 || true
  done
}

wait_for_room() {
  # 轮询 REST 直到出现 hostId=wmzy 且 name=ROOM_NAME 的等待中房间, 打印房间码
  # 容忍慢启动: /skill 加载 + MCP 预热 + 模型推理, MiniMax 可能需 3-5 分钟
  local deadline=$(( $(date +%s) + 300 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local id
    id=$(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" \
         | python3 -c "
import sys,json
try: data=json.load(sys.stdin)
except: 
  print(''); sys.exit()
for r in data:
  if r.get('hostId')=='$HOST_NAME' and r.get('name')=='$ROOM_NAME' and r.get('status')=='等待中':
    print(r['id']); break
" 2>/dev/null || true)
    if [ -n "$id" ]; then echo "$id"; return 0; fi
    sleep 3
  done
  echo ""; return 1
}

# ── 1. 启动 wmzy (房主) ──
cleanup_stale_room

HOST_PROMPT="/skill:sanguosha-play 你是三国杀游戏的房主 AI 玩家。请立即开始游戏, 不要阅读项目源代码或探索文件系统。

第一步(立即执行): 调用 createRoom 工具建房。参数:
- maxPlayers: 5
- playerId: \"$HOST_NAME\"
- timeoutSec: 0
- name: \"$ROOM_NAME\"

第二步: 持续调用 play 工具(不带 action 参数=等待推进)。每次返回 needsAction=true 时, 从 availableActions 中选一个合理操作回传:
- 选将(selectChar): 选技能强力的武将(优先张飞/甄姬/刘备/关羽)。
- 出牌阶段: 有【杀】且 validTargets 非空就出杀; 残血(<maxHealth)且有【桃】就回血; 有锦囊(顺手牵羊/过河拆桥)且距离内有人就用。
- 被杀攻击(respond): 手中有【闪】就打出抵消; 残血时优先保命。
- 弃牌阶段(discard): 保留杀/桃/无懈可击, 弃多余牌使手牌数<=当前体力值。
- 广播型询问(无懈可击等): 视情况回应。

第三步: 游戏中若发现违反三国杀规则的 bug(错误结算、合法操作被拒、非法操作被接受、卡死、判定错误等), 立即调用 reportBug 工具记录: description 写清现象+预期行为+涉及的技能/卡牌。

第四步: gameOver 非空时任务完成。

关键: timeoutSec=0 表示操作无时间限制。直接用 MCP 工具(createRoom/play/reportBug), 通过 write 到 xd://mcp__sanguosha_* 路径调用。不要读源码, 不要用 bash/curl 探测服务器。"

echo "[game-$GAME_N] 启动房主 $HOST_NAME (minimax-code-cn/MiniMax-M3)..."
timeout "$PER_INSTANCE_TIMEOUT" \
  "$OMP_BIN" --model "minimax-code-cn/MiniMax-M3" --cwd "$PROJECT_DIR" --no-lsp -p "$HOST_PROMPT" \
  > "$LOG_DIR/instances/wmzy.log" 2>&1 &
HOST_PID=$!
echo "[game-$GAME_N] wmzy pid=$HOST_PID"

# ── 2. 等待房间码 ──
echo "[game-$GAME_N] 等待 wmzy 建房..."
ROOM_ID=$(wait_for_room || true)
if [ -z "$ROOM_ID" ]; then
  echo "[game-$GAME_N] ❌ 房主建房超时(300s), 终止本局, 杀掉 wmzy 进程防止孤儿"
  kill "$HOST_PID" 2>/dev/null || true
  pkill -P "$HOST_PID" 2>/dev/null || true
  wait "$HOST_PID" 2>/dev/null || true
  exit 2
fi
echo "[game-$GAME_N] ✅ 房间码=$ROOM_ID"

# ── 3. 启动 4 个 guest ──
guest_prompt() {
  local name="$1" roomid="$2"
  cat <<PROMPT
/skill:sanguosha-play 你是三国杀游戏的 AI 玩家, 需要加入指定房间。请立即开始, 不要阅读项目源代码或探索文件系统。

第一步(立即执行): 调用 joinRoom 工具加入房间。参数:
- roomId: "$roomid"
- playerId: "$name"
- timeoutSec: 0

第二步: 持续调用 play 工具(不带 action 参数=等待推进)。每次返回 needsAction=true 时, 从 availableActions 中选一个合理操作回传:
- 选将(selectChar): 选技能强力的武将(优先张飞/甄姬/刘备/关羽)。
- 出牌阶段: 有【杀】且 validTargets 非空就出杀; 残血(<maxHealth)且有【桃】就回血; 有锦囊(顺手牵羊/过河拆桥)且距离内有人就用。
- 被杀攻击(respond): 手中有【闪】就打出抵消; 残血时优先保命。
- 弃牌阶段(discard): 保留杀/桃/无懈可击, 弃多余牌使手牌数<=当前体力值。
- 广播型询问(无懈可击等): 视情况回应。

第三步: 游戏中若发现违反三国杀规则的 bug(错误结算、合法操作被拒、非法操作被接受、卡死、判定错误等), 立即调用 reportBug 工具记录: description 写清现象+预期行为+涉及的技能/卡牌。

第四步: gameOver 非空时任务完成。

关键: timeoutSec=0 表示操作无时间限制。直接用 MCP 工具(joinRoom/play/reportBug), 通过 write 到 xd://mcp__sanguosha_* 路径调用。不要读源码, 不要用 bash/curl 探测服务器。
PROMPT
}

# 4 个 guest: 模型 + 玩家名
GUESTS=(
  "sn/deepseek-v4-flash|deepseek-v4-flash-1"
  "sensenova/deepseek-v4-flash|deepseek-v4-flash-2"
  "sn/sensenova-6.7-flash-lite|sensenova-6.7-flash-lite-3"
  "sensenova/sensenova-6.7-flash-lite|sensenova-6.7-flash-lite-4"
)

PIDS=("$HOST_PID")
for entry in "${GUESTS[@]}"; do
  model="${entry%%|*}"
  name="${entry##*|}"
  safe="${name//\//-}"
  echo "[game-$GAME_N] 启动 guest $name ($model)..."
  timeout "$PER_INSTANCE_TIMEOUT" \
    "$OMP_BIN" --model "$model" --cwd "$PROJECT_DIR" --no-lsp -p "$(guest_prompt "$name" "$ROOM_ID")" \
    > "$LOG_DIR/instances/$safe.log" 2>&1 &
  PIDS+=($!)
done

echo "[game-$GAME_N] 全部 5 个实例已启动: ${PIDS[*]}"

# ── 4. 等待所有实例结束 (有界等待: 总时限 = PER_INSTANCE_TIMEOUT, 避免单实例卡死阻塞) ──
FAIL=0
WAIT_DEADLINE=$(( $(date +%s) + PER_INSTANCE_TIMEOUT ))
while [ "$(date +%s)" -lt "$WAIT_DEADLINE" ]; do
  ALL_DONE=1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then ALL_DONE=0; break; fi
  done
  [ "$ALL_DONE" = "1" ] && break
  sleep 10
done
# 超时仍有存活实例: 强制杀掉 (防止孤儿)
for pid in "${PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "[game-$GAME_N] ⚠️ pid=$pid 仍在运行, 强制终止"
    kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
    FAIL=1
  fi
done
wait 2>/dev/null || true

# ── 5. 收集本局反馈 ──
FEEDBACK_FILES=$(find "$FEEDBACK_DIR" -name '*.json' 2>/dev/null | wc -l)
echo "[game-$GAME_N] 本局结束. feedback 文件总数=$FEEDBACK_FILES fail=$FAIL"

# 记录房间码供编排器引用
echo "$ROOM_ID" > "$LOG_DIR/room-id.txt"
exit $FAIL
