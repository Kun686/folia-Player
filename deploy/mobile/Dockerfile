ARG NODE_IMAGE=node:24.17.0-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production
COPY deploy/docker/backend/package.json deploy/docker/backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit
COPY deploy/mobile/*.mjs ./deploy/mobile/
COPY shared/mobile ./shared/mobile
COPY src/utils/replayGain.ts ./src/utils/replayGain.ts
COPY LICENSE ./LICENSE
USER node
EXPOSE 3000
CMD ["node", "deploy/mobile/server.mjs"]
