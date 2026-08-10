# syntax=docker/dockerfile:1.7
#
# Contexto de build: RAIZ do monorepo.
#   docker build -f apps/payment-service/Dockerfile -t loja-veloz-payment-service:local .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

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
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/payment-service ./apps/payment-service
RUN npm run prisma:generate -w @loja-veloz/payment-service \
 && npm run build -w @loja-veloz/shared-types \
                  -w @loja-veloz/shared-config \
                  -w @loja-veloz/observability \
                  -w @loja-veloz/messaging \
 && npm run build -w @loja-veloz/payment-service

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

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/shared-config/dist ./packages/shared-config/dist
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/packages/observability/tracing.js ./packages/observability/tracing.js
COPY --from=build /app/packages/observability/tracing.d.ts ./packages/observability/tracing.d.ts
COPY --from=build /app/packages/messaging/dist ./packages/messaging/dist
COPY --from=build /app/apps/payment-service/dist ./apps/payment-service/dist
COPY --from=build /app/apps/payment-service/generated ./apps/payment-service/generated
COPY --from=build /app/apps/payment-service/prisma ./apps/payment-service/prisma

RUN chown -R node:node /app
USER node

WORKDIR /app/apps/payment-service
EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3003/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
