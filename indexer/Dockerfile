FROM node:22-bookworm-slim
WORKDIR /app/indexer
COPY indexer/package.json indexer/package-lock.json ./
RUN npm ci --ignore-scripts
COPY shared /app/shared
COPY indexer/config.yaml indexer/schema.graphql indexer/tsconfig.json ./
COPY indexer/abis ./abis
COPY indexer/scripts ./scripts
COPY indexer/src ./src
CMD ["node", "scripts/start.mjs"]
