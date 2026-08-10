# syntax=docker/dockerfile:1.7
#
# IMPORTANTE: o contexto de build e a RAIZ do monorepo, nunca a pasta do
# servico. O build depende do package-lock.json da raiz e dos pacotes em
# packages/. Comando correto, a partir da raiz:
#
#   docker build -f apps/api-gateway/Dockerfile -t loja-veloz-api-gateway:local .
#
# O docker-compose.yml ja declara `context: .` e `dockerfile: apps/.../Dockerfile`.

ARG NODE_IMAGE=node:22-bookworm-slim

# --- Base comum -------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# --- Dependencias -----------------------------------------------------------
# Copiar apenas os manifests antes do codigo preserva o cache de camadas:
# alterar um arquivo .ts nao invalida a instalacao de dependencias.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/observability/package.json packages/observability/
COPY packages/messaging/package.json packages/messaging/
COPY apps/api-gateway/package.json apps/api-gateway/
COPY apps/order-service/package.json apps/order-service/
COPY apps/inventory-service/package.json apps/inventory-service/
COPY apps/payment-service/package.json apps/payment-service/
# npm ci exige o package-lock.json real, gerado por `npm install` e versionado.
RUN npm ci

# --- Compilacao -------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api-gateway ./apps/api-gateway
RUN npm run build -w @loja-veloz/shared-types \
                  -w @loja-veloz/shared-config \
                  -w @loja-veloz/observability \
 && npm run build -w @loja-veloz/api-gateway

# --- Imagem final -----------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/observability/package.json packages/observability/
COPY packages/messaging/package.json packages/messaging/
COPY apps/api-gateway/package.json apps/api-gateway/
COPY apps/order-service/package.json apps/order-service/
COPY apps/inventory-service/package.json apps/inventory-service/
COPY apps/payment-service/package.json apps/payment-service/

# Reinstala sem dependencias de desenvolvimento. O lockfile e o mesmo, entao
# as versoes sao identicas as usadas na compilacao.
RUN npm ci --omit=dev && npm cache clean --force

# Apenas os artefatos compilados entram na imagem final.
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/shared-config/dist ./packages/shared-config/dist
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/packages/observability/tracing.js ./packages/observability/tracing.js
COPY --from=build /app/packages/observability/tracing.d.ts ./packages/observability/tracing.d.ts
COPY --from=build /app/apps/api-gateway/dist ./apps/api-gateway/dist

# A imagem oficial ja traz o usuario "node" (uid 1000). Executar como nao-root
# e requisito do Pod Security Standard "restricted" aplicado no Kubernetes.
RUN chown -R node:node /app
USER node

WORKDIR /app/apps/api-gateway
EXPOSE 8080

# Healthcheck sem curl ou wget: usa o fetch global do Node 22, que ja esta na
# imagem. Instalar um cliente HTTP so para o healthcheck aumentaria a
# superficie de ataque sem necessidade.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Forma exec: o node vira PID 1 e recebe SIGTERM diretamente, o que faz o
# graceful shutdown implementado na aplicacao realmente ser acionado.
CMD ["node", "dist/server.js"]
