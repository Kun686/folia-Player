# Apply only the authenticated mobile-search extension to an already pinned QQ API image.
ARG QQ_API_IMAGE
FROM ${QQ_API_IMAGE}
USER root
ARG QQ_SOURCE_SHA256
COPY deploy/mobile/patch-qq-search.mjs deploy/mobile/qqSearchRoute.cjs deploy/mobile/qq-search-server.cjs /app/mobile/
RUN FOLIA_QQ_SOURCE_SHA256=$QQ_SOURCE_SHA256 node /app/mobile/patch-qq-search.mjs
USER node
CMD ["node", "/app/mobile/qq-search-server.cjs"]
