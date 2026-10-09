FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY api ./api
COPY worker ./worker
CMD ["node", "worker/start.js"]
