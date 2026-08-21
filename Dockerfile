# syntax=docker/dockerfile:1

FROM node:24-alpine AS dependencies

WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:24-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SECOND_BRAIN_VAULT=/app/vault \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TZ=UTC

COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
RUN chmod -R a+rX /app

EXPOSE 3000
USER node

CMD ["node", "server.js"]
