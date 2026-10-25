# edge (API gateway) image for AWS: Kong DB-less + routes generated from backend service metadata.
#   ac docker build edge      (runs `ac kong --cloud` first → kong.cloud.yml with Service Connect upstreams)
FROM kong:3.9.4
COPY kong.cloud.yml /kong/kong.yml
ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/kong/kong.yml \
    KONG_PROXY_LISTEN=0.0.0.0:8000 \
    KONG_ADMIN_LISTEN=127.0.0.1:8001 \
    KONG_PROXY_ACCESS_LOG=/dev/stdout \
    KONG_PROXY_ERROR_LOG=/dev/stderr
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD kong health
