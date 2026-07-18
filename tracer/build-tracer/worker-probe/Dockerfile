# WP-2.0 tracer: worker image probe.
# Proves that Prisma 7 + @prisma/adapter-pg (WASM query compiler, driver
# adapter, no native query engine binary) can be shipped through a
# `pnpm deploy` artifact and run a real query against PostgreSQL inside a
# Linux/amd64 container, with a dependency tree that never pulls in `next`.
#
# Build context MUST be this directory (tracer/build-tracer/worker-probe), e.g.:
#   docker build --platform linux/amd64 -f tracer/build-tracer/worker-probe/Dockerfile \
#     -t petscape-worker-tracer:latest tracer/build-tracer/worker-probe

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# ---- deps + generate + deploy (build stage) ----
FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/probe-worker/package.json packages/probe-worker/package.json
RUN pnpm install --frozen-lockfile

COPY packages/probe-worker packages/probe-worker

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
RUN pnpm --filter probe-worker exec prisma generate

RUN pnpm --filter probe-worker deploy --legacy /deploy

# ---- run ----
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 worker \
  && adduser --system --uid 1001 worker

COPY --from=build --chown=worker:worker /deploy ./

USER worker
CMD ["node", "src/index.js"]
