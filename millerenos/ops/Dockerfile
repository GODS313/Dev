# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
RUN npm ci --no-audit --no-fund
COPY apps ./apps
RUN npm run build && npm prune --omit=dev --workspaces --include-workspace-root=false

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 10001 millerenos
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/apps/server/package.json ./apps/server/package.json
COPY --from=build /src/apps/server/dist ./apps/server/dist
COPY --from=build /src/apps/miniapp/dist ./apps/miniapp/dist
USER millerenos
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "const p=new URL(process.env.PUBLIC_BASE_URL||'http://x').pathname.replace(/\\/+$/,'');fetch('http://127.0.0.1:8080'+p+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
