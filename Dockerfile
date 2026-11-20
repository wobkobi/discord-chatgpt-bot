# Debian, not Alpine: sharp ships prebuilt libvips binaries for glibc, and on musl
# it needs a separate prebuild that is easy to lose between installs. Trixie over
# bookworm for newer packages, which is where most base-image advisories come from.
# The major matches .nvmrc.

# ---------------------------------------------------------------- build stage
FROM node:24-trixie-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# simple-git-hooks has nothing to hook here and fails the install without .git.
# Dropping only prepare leaves dependency install scripts (sharp's) alone.
RUN npm pkg delete scripts.prepare \
    && npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# -------------------------------------------------------------- runtime stage
FROM node:24-trixie-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./

RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=builder /app/build ./build

# characterService falls back to the committed markdown guide example when neither
# data/markdownGuide.md nor src/config/markdownGuide.md exists. persona.json is not
# shipped: each bot keeps its own in its data/ mount.
COPY src/config/markdownGuide.example.md ./src/config/

# Runs unprivileged, so the directories it writes have to be owned by that user.
# The TrueNAS compose overrides the uid to 568 and bind-mounts both, so there the
# ownership comes from the host folders instead.
RUN mkdir -p data logs && chown -R node:node /app/data /app/logs

USER node

# Memory, conversations, guild config and persona live in data/; rotated logs in
# logs/. Without volumes a restart loses all of it.
VOLUME ["/app/data", "/app/logs"]

# Baked in so the boot log can say which build is running. A restart that quietly
# kept the previous image is otherwise indistinguishable from one that picked up
# the new one. Last, and after the COPY layers, so changing it does not invalidate
# the cache for anything above.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

# Not `npm start`, which would rebuild. index.ts handles SIGTERM, so `docker stop`
# disconnects from Discord cleanly rather than waiting out the kill timeout.
CMD ["node", "build/index.js"]
