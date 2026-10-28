FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY web/package.json web/package.json
COPY worker/package.json worker/package.json
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --frozen-lockfile
COPY packages/server packages/server
RUN pnpm --filter @petscape/server exec prisma generate

# Matching PostgreSQL 16 tools provide an actual pre-release dump, even when
# the host still has PostgreSQL 14 clients. No host package upgrade is needed.
FROM postgres:16-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
RUN node --version && pg_dump --version
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages/server ./packages/server
ENV NODE_ENV=production
WORKDIR /workspace/packages/server
ENTRYPOINT []
CMD ["node", "scripts/verify-deploy-migration-history.mjs"]
