# Self-hosting catalog deployment

This directory is the source of truth for the Docker-based self-hosting
catalog submissions for SeerrNG. The adapters use the public Docker Hub image
so new installations do not need a registry login.

## Current stable image

```text
docker.io/snapetech/seerrng:v3.27.1
```

The image supports `linux/amd64` and `linux/arm64` and serves its web UI on
TCP port `5055`. TCP port `5056` is available for the built-in HTTPS listener
when it is enabled in the application configuration. Persist `/app/config`.

The platform-specific submissions prepared from this contract are CasaOS /
ZimaOS, Umbrel, TrueNAS, Cosmos, CapRover, Portainer, Co-op Cloud, Cloudron,
and StartOS. Unraid and YunoHost are maintained separately.
