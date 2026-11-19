# Build context is the repository root (see docker-compose.yml) so the
# image can include both the web app and the documentation site.

FROM node:22-alpine AS app
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS docs
WORKDIR /src/docs-site
COPY docs-site/package.json docs-site/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY docs-site/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/docker/40-argus-real-ip.sh /docker-entrypoint.d/40-argus-real-ip.sh
COPY --from=app /src/frontend/dist /usr/share/nginx/html
COPY --from=docs /src/docs-site/build /usr/share/nginx/html/docs
HEALTHCHECK --interval=15s --timeout=4s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
