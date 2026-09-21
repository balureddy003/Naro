# Naro runtime image — the CLI runs TypeScript sources directly
# (Node ≥22.18 native type stripping), so no build step is required.
#
#   docker build -t naro .
#   docker run -p 8080:8080 -v "$PWD/my-agent.ts:/app/agent.ts:ro" \
#     naro serve /app/agent.ts --host 0.0.0.0
#
# For Postgres-backed deployments set NARO_PG_URL and point the agent
# module at the Pg stores; for shared-bearer auth set NARO_SERVE_TOKEN.
FROM node:24-alpine

WORKDIR /app
COPY . .
RUN npm ci --omit=dev && npm cache clean --force

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["node", "cli/src/bin.ts"]
CMD ["--help"]
