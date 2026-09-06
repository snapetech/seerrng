ARG BUILDPLATFORM
ARG TARGETPLATFORM

FROM public.ecr.aws/docker/library/node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS target-base
ARG SOURCE_DATE_EPOCH
ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV npm_config_nodedir="/usr/local"
RUN apk add --no-cache python3 py3-setuptools make g++ gcc libc6-compat bash && \
  npm config set fetch-retries 5 && \
  npm config set fetch-retry-mintimeout 20000 && \
  npm config set fetch-retry-maxtimeout 120000 && \
  npm install --global node-gyp@13.0.1 pnpm@10.24.0

FROM target-base AS prod-deps

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY bin/prepare.mjs ./bin/prepare.mjs

RUN --mount=type=cache,id=pnpm-prod,target=/pnpm/store CI=true pnpm install --prod --frozen-lockfile

# Remove large native modules for linux-x64-gnu platform (we use alpine which is musl-based)
# not supported in pnpm for now due to this bug: https://github.com/pnpm/pnpm/issues/9654
RUN du -shL ./node_modules/.pnpm/* | grep '[0-9]M.*' | grep 'linux-x64-gnu@' | awk '{print $2}' | xargs rm -rf
# Remove large module files not needed for production
RUN if [ -d node_modules/.pnpm ]; then \
  find node_modules/.pnpm -type d \( \
  -path "*ace-builds/src-noconflict" -o \
  -path "*ace-builds/src" -o \
  -path "*ace-builds/src-min" -o \
  -path "*country-flag-icons/react" -o \
  -path "*country-flag-icons/string" -o \
  -path "*country-flag-icons/1x1" -o \
  -path "*@heroicons/react/16" \
  \) -exec rm -rf {} + || true; \
  fi

FROM --platform=$BUILDPLATFORM public.ecr.aws/docker/library/node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS build-base
ARG SOURCE_DATE_EPOCH
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ENV BUILDPLATFORM=${BUILDPLATFORM:-linux/amd64}
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV npm_config_nodedir="/usr/local"
RUN apk add --no-cache python3 py3-setuptools make g++ gcc libc6-compat bash && \
  npm config set fetch-retries 5 && \
  npm config set fetch-retry-mintimeout 20000 && \
  npm config set fetch-retry-maxtimeout 120000 && \
  npm install --global node-gyp@13.0.1 pnpm@10.24.0

FROM build-base AS build

ARG COMMIT_TAG
ARG BUILD_VERSION=main
ENV COMMIT_TAG=${COMMIT_TAG}
ENV BUILD_VERSION=${BUILD_VERSION}

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY bin/prepare.mjs ./bin/prepare.mjs

RUN --mount=type=cache,id=pnpm-build,target=/pnpm/store CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

RUN rm -rf .next/cache

FROM public.ecr.aws/docker/library/node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
ARG SOURCE_DATE_EPOCH
ARG COMMIT_TAG
ARG BUILD_VERSION=main
ENV NODE_ENV=production
ENV COMMIT_TAG=${COMMIT_TAG}
ENV BUILD_VERSION=${BUILD_VERSION}

RUN apk add --no-cache --upgrade libcrypto3 libssl3 tzdata && \
  rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER node:node

WORKDIR /app

COPY --chown=node:node package.json next.config.ts seerr-api.yml ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts/export-external-config.mjs ./scripts/export-external-config.mjs
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/healthcheck.mjs
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/dist ./dist

RUN mkdir -p config && \
  touch config/DOCKER && \
  echo "{\"commitTag\": \"${COMMIT_TAG}\", \"buildVersion\": \"${BUILD_VERSION}\"}" > committag.json

EXPOSE 5055 5056

CMD [ "node", "dist/index.js" ]
