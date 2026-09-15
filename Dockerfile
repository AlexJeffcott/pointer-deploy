# The image holds the server and nothing else.
#
# There is no dist/ and no node_modules: the server has no runtime dependency
# beyond Bun, and every file a visitor loads comes from the store. That is why
# this image is rebuilt when the server changes, not when the application does.

FROM oven/bun:1.4-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY build.ts ./
# `bun run typecheck` covers scripts/, and probe-cold-planner.ts and
# probe-split-channel.ts import from features/support. Without this COPY the
# build stage fails on TS2307 and the image is never made. The runtime stage
# below copies src/server alone, so nothing here reaches the image that runs.
COPY features ./features

RUN bun run typecheck
RUN bun test src/server

# --- runtime ---------------------------------------------------------------
FROM oven/bun:1.4-alpine AS runtime

WORKDIR /app

COPY --from=build --chown=bun:bun /app/src/server ./src/server

USER bun

ENV BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache
ENV TMPDIR=/tmp
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/server/index.ts"]
