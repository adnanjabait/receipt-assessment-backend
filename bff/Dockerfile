# ---- Base (install deps) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ---- Runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Public HTTP port for GraphQL server
ENV PORT=4000
# These tell BFF how to reach gRPC **inside the Docker/ECS network**
ENV GRPC_HOST=grpc-service
ENV GRPC_PORT=50051

COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY proto ./proto
# If BFF also needs the proto files, copy at compose/ECS build-time
EXPOSE 4000

CMD ["node", "bffserver.js"]
