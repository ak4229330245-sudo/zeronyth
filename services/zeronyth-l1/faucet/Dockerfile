FROM node:22.23.3-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node server.mjs signer-queue.mjs ./
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
