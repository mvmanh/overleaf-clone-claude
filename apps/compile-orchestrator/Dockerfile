# syntax=docker/dockerfile:1.7
# Compile worker image (build context: repository root).
#
# ⚠️ In docker-compose this container gets the host Docker socket so it can start
# one sandbox container per compile. The socket is root-equivalent on the host:
# TRUSTED LOCAL USE ONLY. Production uses a dedicated gVisor/microVM sandbox pool
# (docs/security/compile-sandbox.md) and the security gate refuses runc there.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
ARG DOCKER_CLI_IMAGE=docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c

FROM ${DOCKER_CLI_IMAGE} AS dockercli

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
# Optional corporate/TLS-intercepting proxy CA:
#   docker build --secret id=extra_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && pnpm install --frozen-lockfile --filter "@latex-cloud/compile-orchestrator..." \
 && pnpm --filter "@latex-cloud/compile-orchestrator^..." build \
 && pnpm --filter @latex-cloud/compile-orchestrator build \
 && pnpm --filter @latex-cloud/compile-orchestrator deploy --legacy --prod /out \
 && cp -r apps/compile-orchestrator/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY --from=build /out /app
CMD ["node", "--enable-source-maps", "dist/worker/main.js"]
