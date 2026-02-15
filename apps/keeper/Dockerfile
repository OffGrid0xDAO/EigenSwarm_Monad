# ── Stage 1: Prune monorepo ────────────────────────────────────────────
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g turbo@^2

WORKDIR /app
ARG CACHEBUST=1
COPY . .
RUN turbo prune @eigenswarm/keeper --docker

# ── Stage 2: Install deps & build ─────────────────────────────────────
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat python3 make g++ musl-dev
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Install dependencies first (layer cache)
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=@eigenswarm/keeper

# ── Stage 3: Production runner ────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libstdc++
RUN npm install -g tsx@^4

WORKDIR /app
ENV NODE_ENV=production

# Copy full workspace (keeper runs via tsx, not a compiled bundle)
COPY --from=installer /app/ ./

# Create data directory for SQLite volume mount
RUN mkdir -p /data

EXPOSE 3001
ENV PORT=3001
ENV DB_PATH=/data/eigenswarm.db

CMD ["tsx", "apps/keeper/src/index.ts"]
