# syntax=docker/dockerfile:1
FROM node:22-alpine AS ui-build
ENV VITE_E2A2O_FILM=0
WORKDIR /build/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
COPY samples/ /build/samples/
RUN npm run build

FROM rust:1-alpine3.22 AS core-build
RUN apk add --no-cache build-base openssl-dev pkgconf
WORKDIR /build/core
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src/ ./src/
# Use Alpine's shared OpenSSL and musl; do not carry a toolchain into runtime.
ENV RUSTFLAGS="-C target-feature=-crt-static" CARGO_PROFILE_RELEASE_STRIP=true
RUN cargo build --locked --release

# The core intentionally binds loopback. This small relay shares its network
# namespace in Compose and preserves HTTP headers and WebSocket traffic.
FROM alpine:3.22 AS gateway
RUN apk add --no-cache socat
USER 10001:10001
ENTRYPOINT ["socat", "TCP-LISTEN:8080,bind=0.0.0.0,reuseaddr,fork", "TCP:127.0.0.1:4321"]

FROM alpine:3.22 AS app
RUN apk add --no-cache ca-certificates git libgcc libssl3 \
    && mkdir -p /data/map && chown -R 10001:10001 /data
WORKDIR /app
COPY --from=core-build /build/core/target/release/e2a2o-core /usr/local/bin/e2a2o-core
COPY --from=ui-build /build/ui/dist/ /app/ui/
COPY samples/ /app/samples/
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
COPY dependency-licences/ /app/dependency-licences/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/docker-entrypoint
ENV E2A2O_DATA=/data/map E2A2O_UI=/app/ui E2A2O_SAMPLES=/app/samples PORT=4321 \
    E2A2O_HOSTED=1 E2A2O_DEV_TOOLS=0 E2A2O_CODE_CANVAS=0 E2A2O_TRACE=0 HELPERS_RUN=off
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint"]
