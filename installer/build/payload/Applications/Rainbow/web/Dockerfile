# Multi-stage build for rainbow-web.
#
# Stage 1: install all deps (incl. devDependencies) and compile TypeScript.
# Stage 2: production node_modules + the compiled JS only.
#
# Dashboard static files are NOT baked into the image — the orchestrator
# bind-mounts dashboard/dist at /usr/share/web/dashboard at runtime so we can
# iterate on the UI without rebuilding this image.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV RAINBOW_DASHBOARD_DIR=/usr/share/web/dashboard
ENV RAINBOW_APPS_DIR=/var/lib/rainbow/apps

# Production deps only.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS.
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
