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
