# Release Channels

Release publishing is coordinated by `.github/workflows/release.yml` after a `v*`
tag is published. Package workflows are dispatch-only so a tag release does not
double-publish.

## Package Scope

Linux packages install SeerrNG as a standalone Node service with its own system
user, service unit, config environment file, and state directory. They do not
install or manage Lidarr, Bookshelf, Readarr, Sonarr, Radarr, Plex, Jellyfin, or
Emby. Those services remain optional external integrations configured from
SeerrNG after installation.

## Live Test Deployment

`request.snape.tech` is not connected to a developer's local checkout or local
`pnpm dev` process. It is served by the container running on `seerr.home`
(`kspls0` in CI), and that container is replaced only when the deployment path
pulls and starts a new image.

The authoritative live deployment path is GitHub Actions:

1. Push the desired commit to `snapetech/seerrng` `main`.
2. Wait for `.github/workflows/ci.yml` (`SeerrNG CI`) to build and push
   `ghcr.io/snapetech/seerrng:main`.
3. Wait for the `Deploy main to seerr.home` job to pass. That job pulls the
   fresh `:main` image on the host, replaces the running container, and verifies
   `/api/v1/status` locally on the host.
4. Only after that deploy job passes should `request.snape.tech` be expected to
   serve the new code. If a browser tab was already open, hard refresh so the
   client downloads the new Next.js bundle.

Local changes, local commits, and a local dev server do not affect
`request.snape.tech`. A fix is live only after it is committed, pushed to the
deploying remote, built into the image, and deployed by the workflow above.

The image publish job retries transient base-image registry failures and retries
the Docker build/push. If the workflow still fails before `Deploy main to
seerr.home`, the live container remains on the last successful image.

To verify the live host from a maintainer workstation:

```bash
scripts/verify-live-deployment.sh "$(git rev-parse HEAD)"
```

The script checks that the `seerr-host` container is running on `kspls0`, that
`/api/v1/status` reports the expected commit, and that the running image has the
same OCI revision label.

## Test Builds and GitLab CI

GitLab CI (`.gitlab-ci.yml`) is available for internal test builds. It builds
and pushes images to the GitLab container registry using:

- branch tag: `$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG`
- commit tag: `$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA`
- default-branch convenience tag: `$CI_REGISTRY_IMAGE:latest`

The GitLab pipeline can also mirror the branch/tag to GitHub and promote the
commit image to GHCR by SHA when the required credentials are configured. It
does not replace the live `seerr.home` container. Use GitLab images for manual
test deployments or isolated validation, not as an implicit live deployment.

Do not run GitHub and GitLab as competing live deployers to the same host. If
GitLab is ever promoted to deploy `request.snape.tech`, first remove or disable
the GitHub `Deploy main to seerr.home` job, then document GitLab as the single
authoritative deployment path.

## Manual Test Build Options

For a one-off test without touching live:

- Run locally with `pnpm dev` and test `http://localhost:5055`.
- Build a local container with `docker build -t seerrng:test .` and run it
  against a disposable config directory.
- Use the GitLab branch/SHA image in a non-live environment.

For live verification, always check the CI run that deployed the image and the
commit SHA it reported. The public `request.snape.tech` endpoint may be behind
Authentik, so CI's host-local `/api/v1/status` verification is the deployer's
source of truth.

## Snapcraft Credentials

The Snap workflow requires the repository secret
`SNAPCRAFT_STORE_CREDENTIALS`. The Snap account ID is not a publish token;
Snapcraft publishing uses exported Ubuntu One/Snap Store login credentials.
The current exported credential is also stored in OpenBao at
`secret/seerrng/snapcraft` under `store_credentials`.

Generate a `seerrng`-scoped credential with:

```bash
/snap/bin/snapcraft export-login --snaps seerrng --acls package_upload,package_release --expires 2026-06-13T00:00:00Z - | gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo snapetech/seerrng
```

Do not write exported Snapcraft credentials into tracked files.
