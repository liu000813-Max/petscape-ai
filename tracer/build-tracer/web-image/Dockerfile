# WP-2.0 tracer: Next.js standalone image probe.
# Verifies public/, .next/static, sharp, and startup work in a Linux/amd64
# container built from the current web/ package (output: 'standalone').
#
# Build context MUST be the repo root's web/ directory, e.g.:
#   docker build --platform linux/amd64 -f tracer/build-tracer/web-image/Dockerfile -t petscape-web-tracer:latest web

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# ---- deps ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- run ----
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
