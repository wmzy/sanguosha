#!/usr/bin/env bash
# scripts/compose-demo-video.sh — 把录制的原始舞台视频与片头/片尾合成最终演示视频。
#
# 用法: ./scripts/compose-demo-video.sh <raw.webm> [out.mp4] [audio.wav]
#
# 依赖 ffmpeg（libopenh264 H.264 编码器；本机 Fedora ffmpeg 无 libx264）。
# 第三参数/同名 audio-*.wav 存在时,把系统采集的游戏音效混入主片段。
set -euo pipefail
RAW="${1:?用法: $0 <raw.webm> [out.mp4] [audio.wav]}"
OUT="${2:-data/demo-video/sanguosha-ai-demo.mp4}"
AUDIO="${3:-}"
if [ -z "$AUDIO" ]; then
  # 自动找与 raw 同目录、同时间戳的 audio-*.wav
  CAND=$(ls -t "$(dirname "$RAW")"/audio-*.wav 2>/dev/null | head -1 || true)
  [ -n "$CAND" ] && AUDIO="$CAND"
fi
if [ -n "$AUDIO" ] && [ ! -f "$AUDIO" ]; then AUDIO=""; fi
# 可选:裁掉录制开头等待 iframe/页面加载的片段(秒)。音视频同步裁切。
TRIM_START="${TRIM_START:-0}"

ASSETS="data/demo-video/assets"
INTRO="$ASSETS/intro.mp4"
OUTRO="$ASSETS/outro.mp4"
FONT="/usr/share/fonts/google-noto-sans-cjk-vf-fonts/NotoSansCJK-VF.ttc"

mkdir -p "$ASSETS"
ensure_title_cards() {
  if [ ! -f "$INTRO" ]; then
    ffmpeg -y -v error -f lavfi -i "color=c=0x0d1220:s=1920x1080:d=4:r=30" \
      -vf "drawtext=fontfile=$FONT:text='三国杀 · AI 多智能体演示':fontcolor=0xF1C40F:fontsize=86:x=(w-text_w)/2:y=390:borderw=2:bordercolor=0x000000,drawtext=fontfile=$FONT:text='5 个独立 omp 进程 × MCP 独立连接':fontcolor=0xD8CBB0:fontsize=36:x=(w-text_w)/2:y=520,drawtext=fontfile=$FONT:text='前端实时观战 + 终端多 Agent 对局':fontcolor=0x8FA0B8:fontsize=26:x=(w-text_w)/2:y=590,fade=t=in:st=0:d=0.5,fade=t=out:st=3.4:d=0.6" \
      -c:v libopenh264 -pix_fmt yuv420p -b:v 4M "$INTRO"
  fi
  if [ ! -f "$OUTRO" ]; then
    ffmpeg -y -v error -f lavfi -i "color=c=0x0d1220:s=1920x1080:d=5:r=30" \
      -vf "drawtext=fontfile=$FONT:text='演示结束 · 感谢观看':fontcolor=0xF1C40F:fontsize=64:x=(w-text_w)/2:y=430,drawtext=fontfile=$FONT:text='pnpm dev  ·  pnpm demo\:ai  ·  AI 对战演示':fontcolor=0x9AA4BA:fontsize=28:x=(w-text_w)/2:y=540,fade=t=in:st=0:d=0.4,fade=t=out:st=4.2:d=0.8" \
      -c:v libopenh264 -pix_fmt yuv420p -b:v 4M "$OUTRO"
  fi
}
ensure_title_cards

# 原始 webm 可能是 25fps / VP8；统一转 30fps 1080p H.264，并在最后一秒淡出。
DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$RAW" 2>/dev/null || echo 0)
if ! awk "BEGIN{exit !($DUR > 1)}"; then
  # 部分崩溃的 webm 读不到 duration，按文件大小兜底；ffmpeg 会解码到结尾。
  echo "⚠️ 无法读取时长，按可用内容合成"
  DUR=9999
fi
MAIN_DUR=$(awk "BEGIN{d=$DUR-$TRIM_START; if(d<0.1)d=0.1; print d}")
FADE_START=$(awk "BEGIN{d=$MAIN_DUR-1.2; if(d<0)d=0; print d}")
echo "[compose] raw=${DUR}s trim=${TRIM_START}s main=${MAIN_DUR}s fade@${FADE_START}s -> $OUT"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -n "$AUDIO" ]; then
  echo "[compose] 音效: $AUDIO"
  ffmpeg -y -v error -ss "$TRIM_START" -i "$RAW" -ss "$TRIM_START" -i "$AUDIO" \
    -vf "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${FADE_START}:d=1.0" \
    -af "atrim=0:${MAIN_DUR},asetpts=PTS-STARTPTS,volume=0.7,apad,afade=t=out:st=${FADE_START}:d=1.0" \
    -t "$MAIN_DUR" -c:v libopenh264 -b:v 6M -pix_fmt yuv420p -c:a aac -b:a 192k \
    "$TMP/main.mp4"
else
  ffmpeg -y -v error -ss "$TRIM_START" -i "$RAW" \
    -vf "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${FADE_START}:d=1.0" \
    -t "$MAIN_DUR" -c:v libopenh264 -b:v 6M -pix_fmt yuv420p -an "$TMP/main.mp4"
fi

# 片头/片尾补静音轨,使 concat 后音轨连续;最终统一重编码一次。
ffmpeg -y -v error -i "$INTRO" -f lavfi -t 4 -i anullsrc=r=48000:cl=stereo \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "$TMP/intro_av.mp4"
ffmpeg -y -v error -i "$OUTRO" -f lavfi -t 5 -i anullsrc=r=48000:cl=stereo \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "$TMP/outro_av.mp4"

ffmpeg -y -v error -i "$TMP/intro_av.mp4" -i "$TMP/main.mp4" -i "$TMP/outro_av.mp4" \
  -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libopenh264 -b:v 6M -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "$OUT"

echo "[compose] 完成: $OUT"
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,codec_name,avg_frame_rate -of json "$OUT"
