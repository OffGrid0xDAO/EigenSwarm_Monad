# ── Stage 1: Prune monorepo ────────────────────────────────────────────
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g turbo@^2

WORKDIR /app
COPY . .
RUN turbo prune @eigenswarm/indexer --docker

# ── Stage 2: Install deps ────────────────────────────────────────────
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .

# ── Stage 3: Production runner ────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat

# Run as non-root user
RUN addgroup --system --gid 1001 ponder && \
    adduser --system --uid 1001 ponder

WORKDIR /app
ENV NODE_ENV=production

COPY --from=installer --chown=ponder:ponder /app/ ./

WORKDIR /app/apps/indexer

USER ponder

EXPOSE 42069
ENV PORT=42069

CMD ["npx", "ponder", "start"]
