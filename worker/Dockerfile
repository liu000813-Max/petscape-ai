# PetScape worker 正式镜像（WP-2.5）。
#
# 本包边界（docs/plans/phase-b-execution-plan.md WP-2.5）：Node 运行时容器，
# 领取/执行/心跳/写结果的正式业务逻辑在 WP-3.4 落地；本镜像现阶段只跑
# worker/src/main.ts 的启动骨架（配置校验 + fail-fast）。不装 Python/uv/
# trimesh/PrusaSlicer 等切片工具层——那是 Phase C 迁移件（tracer/build-tracer
# 的 slicer-probe 已验证可执行性，正式接入不在本包范围）。
#
# 构建期编译链（配方依据 tracer/build-tracer 实测 + WP-2.1 报告 Observations：
# node_modules 内的 .ts 不能被 --experimental-strip-types 剥离类型，
# 必须在构建期把 @petscape/server 与 worker 自身预编译为 .js）：
#   1. pnpm install（workspace 全量，frozen lockfile）
#   2. packages/server: prisma generate → tsc -p tsconfig.build.json（emit ./dist）
#   3. tools/rewrite-server-dist-exports.mjs 把 packages/server/package.json 的
#      exports 从 ./src/**/*.ts 改写为 ./dist/**/*.js（仅本次构建的临时文件系统，
#      不影响仓库内文件——本地开发/CI typecheck 用的是未改写的 exports）
#   4. worker: tsc -p tsconfig.build.json（emit ./dist；此时 moduleResolution
#      nodenext 解析 @petscape/server 时读到的是已改写的 dist exports）
#   5. pnpm --filter @petscape/worker deploy --legacy /deploy
#      （--legacy：pnpm 10+ 默认 injectWorkspacePackages 与本仓库
#      lockfile 配置不匹配，见 docs/operations/wp-2-1-report.md
#      "Worker 制品契约" 节的对照实验结论）
#   6. run 阶段只拷贝 /deploy 产物，容器内运行 node dist/main.js（编译产物，
#      非 --experimental-strip-types 逐文件剥离）
#
# 构建上下文必须是仓库根目录：
#   docker build --platform linux/amd64 -f worker/Dockerfile -t <tag> .

FROM node:24-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# ---- deps（workspace 全量安装，供 tsc 跨包解析与 prisma generate 使用） ----
FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/package.json
COPY worker/package.json worker/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile

# ---- build（prisma generate + tsc 编译 server 与 worker） ----
FROM deps AS build
WORKDIR /workspace
COPY packages/server packages/server
COPY worker worker
COPY tools/rewrite-server-dist-exports.mjs tools/rewrite-server-dist-exports.mjs

RUN pnpm --filter @petscape/server run db:generate
RUN pnpm --filter @petscape/server exec tsc -p tsconfig.build.json
RUN node tools/rewrite-server-dist-exports.mjs packages/server
RUN pnpm --filter @petscape/worker exec tsc -p tsconfig.build.json

RUN pnpm --filter @petscape/worker deploy --legacy /deploy

# ---- run ----
FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 worker \
  && adduser --system --uid 1001 worker

COPY --from=build --chown=worker:worker /deploy ./

USER worker
CMD ["node", "dist/main.js"]
