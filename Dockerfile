ARG  NODE_VERSION=22
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY package*.json ./ /app/
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
