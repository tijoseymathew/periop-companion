#!/usr/bin/env bash
set -euo pipefail

REPO=/home/josey/projects/periop-companion
UI="$REPO/ui"
SCRATCH=/tmp/claude-1001/-home-josey-projects-periop-companion/a1d395ce-de08-4895-b624-3202c792d67c/scratchpad
STORE="$SCRATCH/periop-demo-store"
REC="$SCRATCH/periop-demo-recordings"

mkdir -p "$STORE/_out" "$REC"

PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
BASE_URL="http://127.0.0.1:$PORT"
echo "→ base url: $BASE_URL"
echo "→ store: $STORE"

cd "$REPO"
env \
  PERIOP_CASE_DIR="$STORE" \
  PERIOP_OUT_DIR="$STORE/_out" \
  LANGFUSE_PUBLIC_KEY= LANGFUSE_SECRET_KEY= LANGFUSE_BASE_URL= \
  uv run uvicorn periop.api.app:app --host 127.0.0.1 --port "$PORT" \
  > "$REC/server.log" 2>&1 &
SERVER_PID=$!
echo "→ server pid $SERVER_PID"

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "→ waiting for health…"
for i in $(seq 1 60); do
  if curl -sf "$BASE_URL/api/health" >/dev/null 2>&1; then
    echo "→ healthy"
    break
  fi
  sleep 1
done

cd "$UI"

echo "=== part: intake ==="
node e2e/record_sg0031_demo.mjs --part intake --base-url "$BASE_URL" \
  --out "$REC/part1-intake.webm" 2>&1 | tee "$REC/part1.log"
CASE_ID=$(sed -n 's/^CASE_ID=//p' "$REC/part1.log" | tail -1)
if [ -z "$CASE_ID" ]; then echo "no case id captured, aborting"; exit 1; fi
echo "→ case_id = $CASE_ID"
echo "$CASE_ID" > "$REC/case_id.txt"

echo "=== part: preop ==="
node e2e/record_sg0031_demo.mjs --part preop --base-url "$BASE_URL" --case-id "$CASE_ID" \
  --out "$REC/part2-preop.webm" 2>&1 | tee "$REC/part2.log"

echo "=== part: intraop ==="
node e2e/record_sg0031_demo.mjs --part intraop --base-url "$BASE_URL" --case-id "$CASE_ID" \
  --out "$REC/part3-intraop.webm" 2>&1 | tee "$REC/part3.log"

echo "=== part: postop ==="
node e2e/record_sg0031_demo.mjs --part postop --base-url "$BASE_URL" --case-id "$CASE_ID" \
  --out "$REC/part4-postop.webm" 2>&1 | tee "$REC/part4.log"

kill "$SERVER_PID" 2>/dev/null || true
trap - EXIT

echo "=== concatenating ==="
cd "$REC"
printf "file '%s'\n" part1-intake.webm part2-preop.webm part3-intraop.webm part4-postop.webm > concat.txt
if ffmpeg -y -f concat -safe 0 -i concat.txt -c copy sg0031-demo-full.webm 2>"$REC/ffmpeg-copy.log"; then
  echo "✓ concatenated (stream copy) -> $REC/sg0031-demo-full.webm"
else
  echo "stream copy failed, re-encoding…"
  ffmpeg -y -f concat -safe 0 -i concat.txt -c:v libvpx-vp9 -b:v 2M sg0031-demo-full.webm
  echo "✓ concatenated (re-encoded) -> $REC/sg0031-demo-full.webm"
fi

echo "=== transcoding to mp4 (h.264) — the actually-shareable format ==="
ffmpeg -y -i sg0031-demo-full.webm -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 128k sg0031-demo-full.mp4
echo "✓ mp4 -> $REC/sg0031-demo-full.mp4"

echo "ALL DONE"
