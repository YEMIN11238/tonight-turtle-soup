FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server/ ./server/
COPY --chown=node:node public/ ./public/
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
