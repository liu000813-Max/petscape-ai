# PetScape web 正式镜像（WP-2.5）。
#
# 参照 tracer/build-tracer/web-image/Dockerfile（WP-2.0 已验证的 standalone
# 构建链：public/、.next/static、sharp、启动均正常），改为 pnpm workspace
# 感知的构建上下文（web/ 已是 workspace 成员，pnpm-workspace.yaml 在仓库根）。
#
# 2026-07-18 merge origin/main 后追加：web 新增对 @petscape/server 的运行时
# 依赖（WP-3.1/3.2/3.3 auth/projects/assets application 层），Next build 需要
# 该包的源码与已生成的 Prisma client 才能解析 `@petscape/server/*` 导入。
#
# 构建上下文必须是仓库根目录：
#   docker build --platform linux/amd64 -f web/Dockerfile -t <tag> .

FROM node:24-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# ---- deps ----
FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY web/package.json web/package.json
COPY packages/server/package.json packages/server/package.json
COPY worker/package.json worker/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
WORKDIR /workspace
COPY packages/server packages/server
COPY web web
RUN pnpm --filter @petscape/server run db:generate
RUN pnpm --filter web run build

# ---- run ----
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Monorepo standalone 输出把 Next server.js 落在
# web/.next/standalone/web/server.js（实测确认，见 WP-2.5 报告；输出结构
# 保留 workspace 相对路径，standalone 目录本身相对 build context 是
# web/.next/standalone/，其内再嵌一层 web/ 才是可运行的应用根目录）。
# public/ 与 .next/static 不在 standalone 输出内，需单独拷贝到同一相对位置。
COPY --from=build --chown=nextjs:nodejs /workspace/web/.next/standalone ./
COPY --from=build /workspace/web/public ./web/public
COPY --from=build --chown=nextjs:nodejs /workspace/web/.next/static ./web/.next/static

USER nextjs
EXPOSE 3000
WORKDIR /app/web
CMD ["node", "server.js"]
