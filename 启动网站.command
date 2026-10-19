#!/bin/bash
# 嘉Jaykou工具台 · macOS 启动脚本
# 双击本文件即可启动。若 macOS 提示「无法打开」，请右键本文件 -> 打开。

cd "$(dirname "$0")" || exit 1

PORT=8080
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo ""
echo "  嘉Jaykou工具台   http://localhost:$PORT/"
echo "  目录: $(pwd)"
echo "  停止服务: 回到本窗口按 Ctrl+C"
echo ""

# 开浏览器（后台稍等，等服务起来）
( sleep 1.2; open "http://localhost:$PORT/" ) &

if command -v python3 >/dev/null 2>&1; then
  exec python3 serve_mac.py "$PORT"
elif command -v ruby >/dev/null 2>&1; then
  echo "[提示] 未找到 python3，改用 ruby（部分 AI 工具可能受限）"
  exec ruby serve_mac.rb "$PORT"
elif command -v php >/dev/null 2>&1; then
  echo "[提示] 未找到 python3/ruby，改用 php（部分工具可能无法加载 WASM）"
  exec php -S 127.0.0.1:"$PORT"
else
  echo "[错误] 本机没有 python3 / ruby / php，无法启动本地服务。"
  echo "       建议安装 Python：https://www.python.org/downloads/"
  echo "       或直接把整个目录拖到浏览器（部分工具会失效）。"
  read -r -p "按回车关闭..."
  exit 1
fi
