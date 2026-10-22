FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY contracts ./contracts
COPY services/agents/package.json ./services/agents/package.json
COPY apps/web ./apps/web
RUN npm ci
RUN npm run build -w web

FROM nginx:alpine
RUN apk add --no-cache wget
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 5173
