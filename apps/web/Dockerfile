# ── Stage 1: Prune monorepo ────────────────────────────────────────────
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g turbo@^2

WORKDIR /app
COPY . .
RUN turbo prune @eigenswarm/web --docker

# ── Stage 2: Install deps & build ─────────────────────────────────────
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Install dependencies first (layer cache)
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Build args for Next.js public env vars (baked at build time)
ARG NEXT_PUBLIC_KEEPER_API_URL
ARG NEXT_PUBLIC_EIGENVAULT_ADDRESS
ARG NEXT_PUBLIC_EIGENLP_ADDRESS
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_PRIVY_APP_ID

ENV NEXT_PUBLIC_KEEPER_API_URL=$NEXT_PUBLIC_KEEPER_API_URL
ENV NEXT_PUBLIC_EIGENVAULT_ADDRESS=$NEXT_PUBLIC_EIGENVAULT_ADDRESS
ENV NEXT_PUBLIC_EIGENLP_ADDRESS=$NEXT_PUBLIC_EIGENLP_ADDRESS
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID

# Copy source and build
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=@eigenswarm/web

# ── Stage 3: Production runner ────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=installer /app/apps/web/.next/standalone ./
COPY --from=installer /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
