# deploy/worker.Dockerfile —— WP-3.4 本地验收用 worker 镜像。
# spec: docs/plans/phase-b-execution-plan.md WP-3.4。
#
# 边界声明：同 web.Dockerfile 顶部注释——本文件是本地 compose 验收专用，
# 不是 WP-2.5 双镜像 CI/CD 部署链的产物。
#
# 打包方式取舍（本包在构建过程中现场踩坑发现，记入 PR body）：最初参考
# tracer/build-tracer/worker-probe/Dockerfile 的 `pnpm deploy --legacy` 模式，
# 但该命令会把 @petscape/server 的 .ts 源码**物理复制**进
# /deploy/node_modules/.pnpm/.../node_modules/@petscape/server/ ——一旦文件
# 真正落在 node_modules 目录下，Node 22 的 `--experimental-strip-types` 会
# 直接拒绝执行（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING：类型剥离对
# node_modules 下的文件是硬性不支持，不是配置问题，任何 flag 组合都绕不过）。
# tracer 探针当时的目标包（packages/probe-worker）没有触发这个问题，掩盖了这条坑。
#
# 本包改为不用 pnpm deploy：保留完整 pnpm workspace 目录结构运行
# （worker/ 与 packages/server 是同级目录，worker 通过 node_modules 内的
# symlink 而非物理复制引用 @petscape/server——symlink 目标路径本身不在
# node_modules 下，Node 的类型剥离检查按符号链接解析后的真实路径判断，
# 因此不受此限制）。代价：镜像体积比理论上的 pnpm deploy 精简产物大
# （带上了完整 node_modules，含开发依赖的间接产物），但本包边界是"验证构建链
# 与运行语义"而非"镜像体积优化"（体积优化留给 WP-2.5 真实部署链决策）。
#
# 构建：docker build -f deploy/worker.Dockerfile -t petscape-worker-local:latest .

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# ---- deps + generate ----
FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY web/package.json web/package.json
COPY worker/package.json worker/package.json
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --frozen-lockfile

COPY worker worker
COPY packages/server packages/server
COPY web/public/mockup-assets/mock-model.stl web/public/mockup-assets/mock-model.stl

RUN pnpm --filter @petscape/server exec prisma generate

# ---- run（保留完整 workspace 目录结构，不做 pnpm deploy 物理拷贝） ----
FROM base AS run
WORKDIR /workspace
ENV NODE_ENV=production

# WP-OPS-1: this exact-SHA worker image is also the one-shot Prisma migration
# runner. Prisma needs OpenSSL available to select its query engine reliably.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# WP-B7-1: pinned server-side mesh analyzer runtime. Dependencies are baked into
# the image; production jobs never download Python packages at request time.
COPY --from=ghcr.io/astral-sh/uv:0.8.12 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv python install 3.12.11 \
  && uv venv /opt/mesh-venv --python 3.12.11 \
  && uv pip install --python /opt/mesh-venv/bin/python trimesh==4.12.2 numpy==2.5.1 \
  && chmod -R a+rX /opt/uv-python /opt/mesh-venv
ENV MESH_ANALYZER_PYTHON_BIN=/opt/mesh-venv/bin/python

RUN addgroup --system --gid 1001 worker \
  && adduser --system --uid 1001 worker

COPY --from=build --chown=worker:worker /workspace/node_modules ./node_modules
COPY --from=build --chown=worker:worker /workspace/worker ./worker
COPY --from=build --chown=worker:worker /workspace/packages/server ./packages/server
COPY --from=build --chown=worker:worker /workspace/web/public/mockup-assets/mock-model.stl ./web/public/mockup-assets/mock-model.stl
COPY --from=build --chown=worker:worker /workspace/pnpm-workspace.yaml /workspace/package.json ./

USER worker
WORKDIR /workspace/worker
# worker/package.json 没有独立 build 步骤（TS 源码直接用 node --experimental-strip-types
# 跑，与本地 dev/start 脚本一致）。
CMD ["node", "--experimental-strip-types", "src/main.ts"]
