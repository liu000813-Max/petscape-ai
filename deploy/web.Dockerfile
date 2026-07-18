# deploy/web.Dockerfile —— WP-3.4 本地验收用 web 镜像。
# spec: docs/plans/phase-b-execution-plan.md WP-3.4。
#
# 边界声明（PR body 同步记录）：本文件是为本地 Docker Compose 端到端验收现搭的
# 最小镜像，不是 WP-2.5 的双镜像 CI/CD 部署链产物——那条链因 ACR 待用户控制台
# 开通而挂起，尚未合并到 main。ECS 上的真实部署验证留给 WP-2.5 收口后的 WP-4.2
# 回滚演练覆盖。本文件参考 tracer/build-tracer/web-image/Dockerfile 的 standalone
# 输出模式，但构建上下文改为仓库根（pnpm workspace 需要 web + packages/server
# 两个 workspace 成员一起装依赖），而非该 tracer 单独构建 web/ 目录的做法。
#
# 构建：docker build -f deploy/web.Dockerfile -t petscape-web-local:latest .
#   （构建上下文 = 仓库根，因为要装 workspace 依赖）

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# WP-4.2：构建期注入 git SHA 作为可观察版本标识（/api/healthz 的 version
# 字段消费）。未传入时下游 ENV 为空字符串，healthz 按"无该 env 时返回 null"
# 处理。

# ---- deps（装全部 workspace 依赖，含 packages/server 与 web） ----
FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY web/package.json web/package.json
COPY worker/package.json worker/package.json
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/web/node_modules ./web/node_modules
COPY --from=deps /workspace/packages/server/node_modules ./packages/server/node_modules
COPY . .

# 生成 Prisma client（web 侧 getServerContext 需要 @prisma/client 生成产物）。
# 生成只需要 schema，不需要真实数据库连接。
RUN pnpm --filter @petscape/server exec prisma generate

RUN pnpm --filter web build

# ---- run ----
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next standalone 输出把被引用的 workspace 依赖（@petscape/server）一并打包进
# server.js 旁的 node_modules 追踪结果里，不需要单独 COPY packages/server。
COPY --from=build /workspace/web/public ./public
COPY --from=build --chown=nextjs:nodejs /workspace/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /workspace/web/.next/static ./web/.next/static

USER nextjs
EXPOSE 3000

# standalone 输出的 server.js 路径跟随原始 workspace 目录结构（web/server.js），
# 而非扁平在 /app/server.js——pnpm workspace 场景下 next 会保留相对路径。
CMD ["node", "web/server.js"]
