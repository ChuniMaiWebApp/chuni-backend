# =============================================================================
# ChuniMai API
#
# Three stages so the image that runs in production carries neither the
# TypeScript sources nor the ~250 MB of build tooling that produced dist/.
#
# The `builder` stage is kept as a named target on purpose: docker-compose.yml
# reuses it for the one-shot `migrate` service. Migrations are plain .sql files
# applied by scripts/migrate.ts, and `nest build` deliberately excludes
# scripts/ (see tsconfig.build.json), so the runner image has no ts-node to
# execute it with. Running migrations from the builder keeps the runtime image
# slim without compiling the migration runner a second, separate way.
# =============================================================================

# --- deps: node_modules only, so a source-only change reuses this layer ------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: compiles dist/, and runs migrations when invoked as a service --
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner ------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Loopback inside the container's own namespace would be unreachable from
# nginx on the host, so the process binds every interface here. The container
# is what limits exposure: compose publishes only to 127.0.0.1.
ENV HOST=0.0.0.0
ENV PORT=3333

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# Song and course fixtures (removed if data directory does not exist)
# COPY data ./data

# node:22-alpine ships an unprivileged `node` user; root inside a container is
# still root on the host if anything ever escapes.
USER node

EXPOSE 3333

# busybox wget, because the image has no curl and adding one for a health probe
# is not worth the layer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/api/v1/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "dist/main.js"]
