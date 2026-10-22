FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package.json package-lock.json ./
COPY contracts ./contracts
COPY services/agents ./services/agents
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts
WORKDIR /app/services/agents
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
