# ---- Stage 1: Builder (production dependency install) ----
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install production-only dependencies from the lockfile for reproducible builds.
# package*.json covers both package.json and package-lock.json.
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Stage 2: Runner (minimal runtime) ----
# Node 22 ships a native global WebSocket, which @supabase/realtime-js requires at
# import time -- no experimental flags needed.
FROM node:22-alpine

# curl is required by the container HEALTHCHECK below
RUN apk add --no-cache curl

ENV NODE_ENV=production

# Use the default non-root user bundled with the node image
USER node

WORKDIR /usr/src/app
RUN chown node:node /usr/src/app

# Production dependencies from the builder stage
COPY --from=builder --chown=node:node /usr/src/app/node_modules ./node_modules

# Application source code
COPY --chown=node:node . .

USER node

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5001/api/health || exit 1

CMD ["node", "app.js"]
