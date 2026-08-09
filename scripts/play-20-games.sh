#!/usr/bin/env bash
# scripts/play-20-games.sh — 自治编排: 连续运行 20 局 5 人 AI 对局, 局间收集并修复 bug。
#
# 用法: ./scripts/play-20-games.sh [START_GAME] [END_GAME]
#   START_GAME 默认 1, END_GAME 默认 20
#
# 自治流程 (局间无需人工介入):
#   for N in START..END:
#     1. (首局前) 在隔离工作目录启动游戏服务器 (端口 3940, 独立 data/ 避免 PGLite 冲突)
#     2. 运行第 N 局 (play-one-game.sh: wmzy 房主 + 4 guests 并行)
#     3. 收集本局 bug 反馈
#     4. 若有 bug: 用 omp glm-5.2 实例分析+修复代码, 重启服务器让修复生效
#     5. 汇总进度到 data/game-logs/progress.log
#
# 完全自治: 服务器由本脚本自管理 (kill/relaunch), bug 修复由独立 omp 实例完成。
# 注意: 项目 .mcp.json 已指向 3940 (本编排器专用服务器), 原始备份在 .mcp.json.bak-ai-arena。
set -uo pipefail

START_GAME="${1:-1}"
END_GAME="${2:-20}"
SERVER_URL="http://localhost:3940"
SERVER_PORT=3940
OMP_BIN="${OMP:-omp}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARENA_DIR="/home/zlt/projects/sanguosha-ai-arena"
LOG_DIR="$PROJECT_DIR/data/game-logs"
PROGRESS_LOG="$LOG_DIR/progress.log"
SERVER_PID_FILE="$LOG_DIR/server.pid"
SERVER_LOG="$ARENA_DIR/logs/server.log"
FEEDBACK_BASE="$ARENA_DIR/data/ai-feedback"

mkdir -p "$LOG_DIR" "$ARENA_DIR/logs" "$ARENA_DIR/data/rooms" "$FEEDBACK_BASE"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$PROGRESS_LOG"; }

# ── 服务器生命周期 (隔离工作目录, 避免 PGLite 冲突) ──
start_server() {
  if [ -f "$SERVER_PID_FILE" ] && kill -0 "$(cat "$SERVER_PID_FILE")" 2>/dev/null; then
    log "服务器已在运行 pid=$(cat "$SERVER_PID_FILE")"
    return 0
  fi
  log "启动游戏服务器 (端口 $SERVER_PORT, 隔离工作目录 $ARENA_DIR)..."
  cd "$ARENA_DIR"
  PORT="$SERVER_PORT" nohup npx tsx src/server/index.ts \
    > "$SERVER_LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$SERVER_PID_FILE"
  cd "$PROJECT_DIR"
  # 等待就绪
  local deadline=$(( $(date +%s) + 40 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -s --max-time 3 "$SERVER_URL/api/rooms" >/dev/null 2>&1; then
      log "服务器就绪 pid=$pid"
      return 0
    fi
    sleep 1
  done
  log "❌ 服务器启动超时"
  return 1
}

restart_server() {
  log "重启游戏服务器以应用代码修复..."
  if [ -f "$SERVER_PID_FILE" ]; then
    local old_pid
    old_pid=$(cat "$SERVER_PID_FILE")
    kill "$old_pid" 2>/dev/null || true
    local deadline=$(( $(date +%s) + 15 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$old_pid" 2>/dev/null || true
    rm -f "$SERVER_PID_FILE"
  fi
  sleep 2
  start_server
}

cleanup() {
  log "编排结束, 清理服务器..."
  if [ -f "$SERVER_PID_FILE" ]; then
    kill "$(cat "$SERVER_PID_FILE")" 2>/dev/null || true
    rm -f "$SERVER_PID_FILE"
  fi
}
trap cleanup EXIT

# ── bug 修复 ──
run_bug_fix() {
  local game_n="$1"
  local pending_dir="$LOG_DIR/game-$game_n/feedback-pending"
  mkdir -p "$pending_dir/processed"

  # 收集本局新建的 feedback 文件 (FEEDBACK_BASE 中 mtime 晚于本局开始标记的)
  if [ -d "$FEEDBACK_BASE" ]; then
    find "$FEEDBACK_BASE" -name '*.json' -newer "$LOG_DIR/game-$game_n/.start-marker" 2>/dev/null \
      | while read -r f; do mv "$f" "$pending_dir/" 2>/dev/null; done
  fi

  local count
  count=$(find "$pending_dir" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    log "第 $game_n 局: 无 bug 反馈, 跳过修复"
    return 0
  fi
  log "第 $game_n 局: 发现 $count 条 bug 反馈, 启动修复 agent (glm-5.2)..."

  local fix_log="$LOG_DIR/game-$game_n/bugfix.log"
  local fix_prompt
  fix_prompt="你是三国杀游戏引擎的 bug 修复工程师。请收集并修复本轮对局发现的 bug。

## 输入
bug 反馈 JSON 文件位于目录: $pending_dir
请用 read 工具读取该目录下所有 *.json 文件 (不含 processed/ 子目录)。每个文件包含:
- description: 现象描述 + agent 认为的预期行为
- 涉及的技能/卡牌等结构化字段
- 当时的游戏状态快照 snapshot

## 任务
1. 读取并理解所有 bug 反馈。
2. 对每个真实 bug, 定位 src/ 下的源码问题并修复。遵循项目约定 (中文业务常量、英文函数名、装备槽 key 中文; 见 CLAUDE.md)。
3. 按 AGENTS.md 测试放置规范添加测试 (优先归入已有 tests/skill-tests/ 或 tests/integration/ 文件, 禁止为单个 bug 新建测试文件)。
4. 运行 \`npm run typecheck\` 和 \`npm test\` 验证。如果不相关测试失败, 记录但不要卡住。
5. 如果你修改了 src/ai-mcp/ 下的代码, 运行 \`npm run build:plugin\` 重新打包 MCP bundle。
6. 修复完成 (或确认非 bug) 后, 把处理过的文件移到 ${pending_dir}/processed/ 目录。
7. 最后输出简短总结: 修复了几个 bug、各是什么问题、改了哪些文件。

注意:
- 有些 feedback 可能不是真实 bug (agent 对规则的误解), 请甄别, 不修非 bug。
- 只修真实 bug, 不要过度重构或扩大改动范围。
- 项目根目录: $PROJECT_DIR"

  cd "$PROJECT_DIR"
  if timeout 3600 "$OMP_BIN" --model "zhipu-coding-plan/glm-5.2" --cwd "$PROJECT_DIR" -p "$fix_prompt" \
     > "$fix_log" 2>&1; then
    log "第 $game_n 局: bug 修复 agent 完成 (详见 bugfix.log)"
  else
    log "第 $game_n 局: ⚠️ bug 修复 agent 异常/超时退出 (code=$?), 详见 bugfix.log"
  fi

  # 修复后必须重启服务器让源码变更生效
  restart_server
}

# ── 主循环 ──
log "========== 开始 20 局编排 (局 $START_GAME..$END_GAME) =========="
log "专用服务器: $SERVER_URL (隔离工作目录 $ARENA_DIR)"
log "bug 反馈目录: $FEEDBACK_BASE"

start_server || { log "❌ 服务器启动失败, 终止"; exit 1; }

for N in $(seq "$START_GAME" "$END_GAME"); do
  log "========== 第 $N 局开始 =========="
  mkdir -p "$LOG_DIR/game-$N"
  touch "$LOG_DIR/game-$N/.start-marker"
  # 运行单局 (该脚本内部管理 5 个 omp 实例)
  if bash "$PROJECT_DIR/scripts/play-one-game.sh" "$N" >> "$PROGRESS_LOG" 2>&1; then
    log "第 $N 局: 对局完成"
  else
    code=$?
    log "第 $N 局: ⚠️ 对局异常退出 (code=$code), 继续下一局"
  fi

  # bug 收集 + 修复
  run_bug_fix "$N"
  log "第 $N 局: 处理完毕"

  # 清理本局残留的游戏中/等待中房间 (本局已结束)
  for id in $(curl -s --max-time 5 "$SERVER_URL/api/rooms?type=multiplayer" 2>/dev/null \
              | python3 -c "
import sys,json
try: data=json.load(sys.stdin)
except: sys.exit()
for r in data:
  if r.get('name','').startswith('AI对局'): print(r['id'])
" 2>/dev/null); do
    curl -s -X DELETE --max-time 5 "$SERVER_URL/api/rooms/$id" >/dev/null 2>&1 || true
  done
done

log "========== 编排全部完成 (局 $START_GAME..$END_GAME) =========="
