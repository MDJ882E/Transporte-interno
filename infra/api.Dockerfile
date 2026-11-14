# API (Node.js). Se construye desde la raíz del repositorio: docker build -f infra/api.Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace api --include-workspace-root
COPY shared shared
COPY api api
RUN npm run build -w api

FROM node:22-alpine
ENV NODE_ENV=production DB_DIR=/app/db
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace api --omit=dev && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY db db
USER node
EXPOSE 3000
# Aplica las migraciones pendientes y arranca.
CMD ["sh", "-c", "node api/dist/cli/migrar.js && node api/dist/servidor.js"]
