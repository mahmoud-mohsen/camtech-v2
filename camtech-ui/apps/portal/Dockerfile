# Build from camtech-ui/ (the npm workspace root, so the shared packages and the lockfile are in the context):
#   docker build -f apps/portal/Dockerfile -t camtech-portal .
# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
# Manifests of every workspace first: `npm ci` is cached until a dependency changes.
COPY package.json package-lock.json .npmrc ./
COPY packages/api-client/package.json packages/api-client/
COPY packages/capture-core/package.json packages/capture-core/
COPY apps/portal/package.json apps/portal/
COPY apps/sdk/package.json apps/sdk/
RUN npm ci
COPY . .
# Build-time defaults. VITE_API_BASE_URL / VITE_SDK_URL can be overridden per deployment with container
# environment variables (written to /env-config.js at start, see docker/env-config.sh); VITE_USE_MOCKS cannot.
ARG VITE_API_BASE_URL=http://localhost:8080/camtech-service
ARG VITE_SDK_URL=http://localhost:5175
ARG VITE_USE_MOCKS=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_SDK_URL=$VITE_SDK_URL VITE_USE_MOCKS=$VITE_USE_MOCKS
RUN npm run build -w @camtech/portal

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html
# Writes /env-config.js from the environment before nginx starts (sed: tolerate CRLF checkouts).
COPY --chmod=755 docker/env-config.sh /docker-entrypoint.d/40-camtech-env-config.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-camtech-env-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
