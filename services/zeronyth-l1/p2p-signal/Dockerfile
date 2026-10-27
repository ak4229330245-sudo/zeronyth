FROM node:22.23.3-alpine
WORKDIR /app
COPY registry.mjs server.mjs ./
USER node
ENV PORT=8788 LISTEN_HOST=0.0.0.0
CMD ["node", "server.mjs"]
