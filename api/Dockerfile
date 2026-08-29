# The service, and nothing else.
#
# A separate image from the shell's server on purpose: the two deploy on their
# own schedules, and an image they shared would make one deploy move both. That
# independence is the whole reason this service exists.

FROM oven/bun:1.4-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY api ./api

# Types are checked over the whole repository by `bun run typecheck`, which
# needs `src/` and `scripts/` that this image deliberately does not carry. What
# runs here is what can run here: the service's own tests, against its own code.
RUN bun test api

# --- runtime ---------------------------------------------------------------
FROM oven/bun:1.4-alpine AS runtime

WORKDIR /app

COPY --from=build --chown=bun:bun /app/api ./api

USER bun

ENV BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache
ENV TMPDIR=/tmp
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "api/index.ts"]
