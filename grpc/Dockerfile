# ---- Base (install deps) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ---- Runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Optional: set the gRPC port by env, default 50051
ENV GRPC_PORT=50051

# If you dynamically load .proto at runtime, copy them:
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Also copy shared proto files from the repo root at compose build-time (see docker-compose)
# EXPOSE is just documentation; ECS/compose uses containerPort
EXPOSE 50051

CMD ["node", "server.js"]
