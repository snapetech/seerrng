# Release Channels

Release publishing is coordinated by `.github/workflows/release.yml` after a `v*`
tag is published. Package workflows are dispatch-only so a tag release does not
double-publish.

The authoritative artifact and architecture inventory is [the release support
matrix](./release-matrix.md). Treat an artifact as supported only when it is
listed there and its publication workflow verifies it after building.

## Release Notes

Release notes have two layers:

- `release-notes/*.md` contains curated, user-facing descriptions. Every
  user-facing pull request must add a new fragment with a category and a
  description of the user impact. Internal-only pull requests must explicitly
  select the no-release-note option in the PR template.
- `.github/cliff.toml` supplies the conventional-commit history for technical
  traceability.

Each curated fragment also records its audience, product area, required action,
and breaking-change status. The fragment body is the release-ready summary;
implementation details stay in the technical history.

CI validates the fragment contract. The tag workflow builds only the current
release section and prepends it to the checked-in `CHANGELOG.md`, preserving all
audited historical sections. The release workflow assembles the current
fragments into the GitHub release body, and the Discord announcement uses the
same content. This prevents a generated changelog from being silently replaced
by generic release text or from erasing older curated history.

The checked-in changelog is audited against every `v3.*` tag. The coverage check
runs in pull-request CI and during tag preparation, so deleting or forgetting a
historical release section fails before publication. A missing version is not
inferred: `v3.2.6` was never tagged and is intentionally absent.

See the [release history audit](./release-history-audit.md) for the scope and
method used to backfill the historical sections.

When reviewing a release, check all three surfaces:

1. `CHANGELOG.md` contains a section for the new version.
2. The GitHub release body starts with the curated user-facing changes.
3. The Discord announcement contains the same useful summary and links to the
   release.

## Retrying a Tagged Release

The release workflow also supports a manual dispatch for an existing tag. Use
this when a post-tag publishing step fails; it checks out the requested tag,
reuses its changelog and image version, and does not move the tag:

```bash
gh workflow run release.yml --repo snapetech/seerrng --ref main -f tag=v3.12.8
```

The tag must already point to a commit contained in `main`. After dispatching,
wait for image publication, signature/SBOM verification, GitHub release
publication, release assets, package-channel dispatch, and Discord announcement
to complete before calling the release finished.

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

Main CI now performs a deployment-host preflight before publishing `:main`: the
config filesystem must be mounted read-write, below 99% usage, and must accept
a temporary write. A read-only or full storage volume is a real deployment
blocker and intentionally fails the run instead of producing a green build that
cannot go live.

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
and pushes only `$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA` to the GitLab
container registry, then scans that exact pushed image. It does not publish a
branch convenience tag, `latest`, or any public registry tag.

GitLab does not mirror branches, create releases, promote public registries, or
replace the live `seerr.home` container. Those jobs remain in the file only as
historical definitions and are explicitly disabled. Use the GitLab image for
manual test deployments or isolated validation, not as an implicit public
release.

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

## Launchpad PPA Target

The PPA workflow requires `LAUNCHPAD_PPA` as a GitHub secret or repository
variable. Use one of these forms:

```bash
ppa:keefshape/seerrng
~keefshape/ubuntu/seerrng
ftp://ppa.launchpad.net/~keefshape/ubuntu/seerrng/
```

Launchpad must already have that PPA. If the archive does not exist, Launchpad
rejects the upload with a message like `Could not find a PPA owned by ...`.
Create the archive in Launchpad first, or point `LAUNCHPAD_PPA` at an existing
archive. As of 2026-06-16, the active target archive is
`ppa:keefshape/seerrng`.

For package smoke tests against a non-default PPA:

```bash
PPA=ppa:keefshape/seerrng packaging/smoke/package-smoke seerrng ppa v3.2.7 --arch amd64
```
