FROM node:20-bookworm-slim AS builder

WORKDIR /builder

COPY package*.json ./

RUN npm ci --omit dev
# RUN npm install

FROM node:20-bookworm-slim AS final

ENV PORT=8081
ENV API_TOKEN=myapitokenchangethislater
ENV ENABLE_API_TOKEN=false
ENV IMG_DOWNLOAD_PATH=/tmp/
ENV MAX_VIDEO_SIZE_MB=100
ENV CACHE_DURATION_IN_SECONDS=86400
ENV MAX_CACHE_ITEM_NUM=200000
ARG APP_USER=node

WORKDIR /app

COPY --from=builder --chown=$APP_USER:$APP_USER /builder/node_modules /app/node_modules

COPY --chown=$APP_USER:$APP_USER . .

USER $APP_USER

EXPOSE $PORT

ENTRYPOINT ["node", "src/index.mjs"]