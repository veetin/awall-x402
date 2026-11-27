# One image for every Node process in the stack: the gateway, the demo origin
# and the console's build and preview. docker-compose.yml overrides the command
# per service, so the image is built once.
#
# .dockerignore keeps node_modules, .git and local .env files out of the build
# context, so the install below is the one that decides the dependency tree.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV AWALL_PORT=8402
EXPOSE 8402
CMD ["pnpm", "--filter", "@awall/gateway", "start"]
