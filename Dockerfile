ARG  NODE_VERSION=22
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Install pnpm (Node.js image includes npm, so this is reliable)
RUN npm install -g pnpm && \
    pnpm --version

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build
RUN pnpm run build

#FROM nginxinc/nginx-unprivileged:stable-alpine
#COPY --from=builder /app/dist /usr/share/nginx/html

FROM joseluisq/static-web-server:latest
COPY --from=builder /app/dist /public
