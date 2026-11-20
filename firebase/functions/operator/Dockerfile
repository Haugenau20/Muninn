# The operator service's image (T137; design, "The container").
#
# Built by Cloud Build from the functions package (`operator/cloudbuild.yaml`,
# context `firebase/functions`); first built for real by the deploy pipeline
# (implementation plan, step 5). Nothing local runs Docker.
#
# - Both base images are pinned by digest; Dependabot keeps the digests
#   current (step 5).
# - The build stage compiles the functions and keeps their production
#   dependencies only. `.dockerignore` keeps `src/operator/dev.ts` and
#   `devSigner.ts` out of the context, so they are never compiled into it.
# - The image runs as distroless's non-root user, with no shell and no
#   package manager.

# node:22-bookworm-slim
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# gcr.io/distroless/nodejs22-debian12:nonroot
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/lib ./lib
USER nonroot
CMD ["lib/operator/main.js"]
