# syntax=docker/dockerfile:1
#
# MagentiQA — container image
#   • Node 20 on Debian bookworm (glibc, so better-sqlite3's native addon builds
#     cleanly and runs reliably — Alpine/musl is avoided on purpose).
#   • Chromium is installed so PDF verification reports render via puppeteer-core;
#     without it the app still works, falling back to self-contained HTML reports.
#   • No app data lives in the image — data/, storage/, backups/ and .env are
#     mounted at run time (see docker-compose.yml).

# ── Stage 1: build native dependencies (better-sqlite3) ─────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Toolchain needed to compile better-sqlite3's native addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim
ENV NODE_ENV=production

# Chromium (+ base fonts) for PDF report generation. puppeteer-core launches the
# system Chromium at /usr/bin/chromium — the path lib/pdf.js already probes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Compiled dependencies from the builder, then the application source.
COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
