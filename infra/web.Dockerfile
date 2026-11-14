# App (PWA) servida por Caddy, que además publica la API bajo /api y gestiona HTTPS.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root
COPY shared shared
COPY web web
RUN npm run build -w web

FROM caddy:2.10-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
