#!/bin/bash
# PetScape 一键启动：首次运行自动安装依赖，然后起服务。
#   ./run-demo.sh        开发模式（localhost:3000，改代码热更新）
#   ./run-demo.sh demo   演示模式（production 构建，无 dev overlay，现场演示用）
# 免 API key 演示：浏览器打开 http://localhost:3000/?mock=1
set -e
cd "$(dirname "$0")/web"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js（需要 >= 18）。请先安装：https://nodejs.org"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "▶ 未检测到 pnpm，自动安装中…"
  corepack enable 2>/dev/null && command -v pnpm >/dev/null 2>&1 || npm install -g pnpm
fi

if [ ! -d node_modules ]; then
  echo "▶ 首次运行，安装依赖（约 1-2 分钟）…"
  pnpm install
fi

if [ "$1" = "demo" ]; then
  echo "▶ production 构建并启动（demo 推荐）…"
  pnpm build && pnpm start
else
  echo "▶ 开发模式启动…"
  pnpm dev
fi
