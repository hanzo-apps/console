# console2 — Hanzo Cloud Console (Next.js 15 + @hanzo/gui). BSD-3-Clause.
# NEXT_PUBLIC_* are inlined at build time (browser config), so they are build args.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_CLOUD_URL=https://console2.hanzo.ai
ARG NEXT_PUBLIC_IAM_URL=https://iam.hanzo.ai
ARG NEXT_PUBLIC_IAM_APP_NAME=hanzo-cloud
ARG NEXT_PUBLIC_IAM_ORG_NAME=hanzo
ARG NEXT_PUBLIC_IAM_CLIENT_ID=hanzo-cloud
ENV NEXT_PUBLIC_CLOUD_URL=$NEXT_PUBLIC_CLOUD_URL \
    NEXT_PUBLIC_IAM_URL=$NEXT_PUBLIC_IAM_URL \
    NEXT_PUBLIC_IAM_APP_NAME=$NEXT_PUBLIC_IAM_APP_NAME \
    NEXT_PUBLIC_IAM_ORG_NAME=$NEXT_PUBLIC_IAM_ORG_NAME \
    NEXT_PUBLIC_IAM_CLIENT_ID=$NEXT_PUBLIC_IAM_CLIENT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4000
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
USER app
EXPOSE 4000
CMD ["npm", "run", "start"]
