FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Settings the browser needs are built into the page. They are build arguments
# because .env stays out of the image; nothing secret belongs here.
ARG NEXT_PUBLIC_AMAP_KEY=""
ARG NEXT_PUBLIC_AMAP_SECURITY_CODE=""
ARG NEXT_PUBLIC_OSM_STYLE=""
RUN NEXT_PUBLIC_AMAP_KEY="$NEXT_PUBLIC_AMAP_KEY" \
  NEXT_PUBLIC_AMAP_SECURITY_CODE="$NEXT_PUBLIC_AMAP_SECURITY_CODE" \
  NEXT_PUBLIC_OSM_STYLE="$NEXT_PUBLIC_OSM_STYLE" \
  npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# migrations run at startup (src/instrumentation-node.ts)
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "server.js"]
