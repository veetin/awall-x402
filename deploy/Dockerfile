# Gateway image. The origin demo and the console have their own commands in
# docker-compose.yml; this image is the process that decides and settles.
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV AWALL_PORT=8402
EXPOSE 8402
CMD ["pnpm", "--filter", "@awall/gateway", "start"]
