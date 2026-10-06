# Upstreams and Dependency Sync Runbook

Confidence: high for dependency surfaces found in tracked files on 2026-09-30.
Confidence: moderate for external service taxonomy because provider contracts
can change outside this repository.

Use this runbook with:

```bash
scripts/catalog-upstreams.sh
scripts/catalog-upstreams.sh --fetch
```

The script is read-only by default. `--fetch` updates remote refs and tags so
fork divergence numbers are current.

## Upstream Catalog

### Fork and repository remotes

| Remote | Role | Current URL |
| --- | --- | --- |
| `upstream` | Product fork source for inherited upstream changes; remote default branch is `develop` | Inspect with `git remote get-url upstream` |
| `origin` | Public SeerrNG GitHub fork | `https://github.com/snapetech/seerrng.git` |
| `gitlab` | Internal GitLab remote / CI mirror | `git@gitlab.home:keith/seerrng.git` |

There are no Git submodules in this checkout. Confidence: high.

The local `main` branch tracks `origin/main`. Upstream Seerr's default branch is
`develop`; use `upstream/HEAD` for routine product-code syncs and
`upstream/main` only when deliberately merging upstream release-line changes.
Confidence: high.

SeerrNG retains `packaging/yunohost/` and its operator documentation as legacy
reference material. YunoHost package synchronization, release-manifest updates,
Git hooks, and GitHub publishing workflows have been removed; the project no
longer publishes package updates to that ecosystem. Existing installations
remain on the last package version published before this change.
Confidence: high.

### JavaScript runtimes and package managers

| Surface | Current pin/source |
| --- | --- |
| Root app `packageManager` | `pnpm@10.24.0` |
| Root app engines | Node `^24.15.0`, pnpm `^10.0.0` |
| Root app Node type definitions | `@types/node@24.19.0` |
| Docs app `packageManager` | `pnpm@10.24.0` |
| Docs app engines | Node `>=22.0` |
| Duplicate detector `packageManager` | `pnpm@10.24.0` |
| Duplicate detector engines | Node `>=22.0` |
| Nix development shell | `pkgs.nodejs_24` (`24.20.0` via `devenv.lock`) |
| SQLite runtime adapter | `better-sqlite3@13.0.3`; its TypeORM peer-range exception is recorded in `pnpm-workspace.yaml` |
| Production Docker base | `public.ecr.aws/docker/library/node:24.21.0-alpine3.23` pinned by digest |
| Local Docker base | `node:24.21.0-alpine3.23` pinned by digest |
| GitHub CI test containers | `node:24.21.0-alpine3.23` pinned by digest |
| Release asset workflow Node | `package.json` Node engine |
| AppImage SWC fallback | `@next/swc-wasm-nodejs@16.3.6` with pinned SHA-512 integrity in the Linux package workflow |

Keep these aligned when moving Node or pnpm. The Dockerfile, Dockerfile.local,
GitHub Actions containers, release asset workflow, `package.json` engines, and
all `packageManager` fields are one runtime set. Confidence: high.

### Package dependency universes

| Surface | Files | Update owner |
| --- | --- | --- |
| Main app and server | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Renovate or manual pnpm update |
| Generated docs | `gen-docs/package.json`, `gen-docs/pnpm-lock.yaml`, `gen-docs/pnpm-workspace.yaml` | Renovate/manual, then docs build |
| Duplicate detector tool | `bin/duplicate-detector/package.json`, `bin/duplicate-detector/pnpm-lock.yaml`, `bin/duplicate-detector/pnpm-workspace.yaml` | Manual/Renovate if configured |
| Security/transitive pins | `overrides` blocks in all `pnpm-workspace.yaml` files | Manual review before removing |
| Local patch | `gen-docs/patches/gray-matter@4.0.3.patch` | Manual rebase or removal when upstream fixes land |

Treat `overrides` as intentional upstream pins. Before deleting one, confirm the
vulnerable or broken transitive version is no longer reachable with `pnpm why`
in the matching package universe. Confidence: high.

### Automation upstreams

| Surface | Files |
| --- | --- |
| GitHub Actions | `.github/workflows/*.yml` action refs and container refs |
| GitLab CI | `.gitlab-ci.yml` job images and promotion tooling |
| Renovate | `.github/renovate.json5`, `.github/renovate/*.json5` |
| Dependabot | `.github/dependabot.yml` |
| Container scanning | Trivy GitHub Action and GitLab `aquasec/trivy` image |
| Code scanning/signing | CodeQL, cosign installer, skopeo, gh CLI, ORAS, Helm tooling |

Renovate is configured for pnpm, Docker, Helm, and GitHub Actions. Dependabot
also tracks npm and GitHub Actions, so duplicate PRs are possible. Confidence:
high.

### Containers, deployment, and packaging

| Surface | Current upstream/pin |
| --- | --- |
| Published image | `ghcr.io/snapetech/seerrng`, `docker.io/snapetech/seerrng` |
| Local Postgres compose | `postgres:18` |
| Bookshelf compose | Digest-pinned BookshelfNG, PostgreSQL, and backend-specific `blampe/rreading-glasses` images |
| Helm chart | `charts/seerr-chart`, image `ghcr.io/snapetech/seerrng`, chart version/appVersion in `Chart.yaml` |
| Snap | `packaging/snap/snapcraft.yaml`, base `core24` |
| Flatpak | `org.freedesktop.Platform` runtime `24.08`, local `flatpak-src/node` and `flatpak-src/seerrng` sources |
| Debian/RPM/AUR | Node package dependency `>= 24.15.0`, release assets from GitHub tags |
| AppImage | Bundled release asset layout and `packaging/appimage/AppRun` |

Package recipes depend on release artifacts and image tags, not only npm
packages. Update them in the same PR as runtime changes when the runtime affects
installed packages. Confidence: high.

### External integration upstreams

Provider clients live under `server/api`, `server/api/servarr`, and
`server/lib/scanners`. The current tracked provider surfaces include Plex,
Jellyfin, TMDB, TVDB, MusicBrainz, OpenLibrary, TheAudioDB, ListenBrainz, Cover
Art Archive, Radarr, Sonarr, Lidarr, Readarr, Tautulli, AniList, and Wikidata.
Bookshelf and rreading-glasses are deployment-side integrations under `deploy/`.
Confidence: moderate.

## Sync Process

### 1. Inventory before changing anything

```bash
git status --short
scripts/catalog-upstreams.sh --fetch
```

Stop if the worktree has unrelated changes in files you need to touch. Move the
sync work to a branch:

```bash
git switch main
git pull --ff-only origin main
git switch -c sync/upstreams-$(date +%Y%m%d)
```

### 2. Merge product upstream

Use a merge branch for upstream Seerr changes. A long-lived fork needs visible
merge boundaries and conflict history. Confidence: high.

```bash
git fetch upstream --prune
git merge --no-ff upstream/HEAD
```

During conflict resolution, preserve SeerrNG-specific branding, package names,
release workflows, Docker image names, deployment host assumptions, and added
providers. Re-run the attribution guard before committing:

```bash
git add -A
bash scripts/check-attribution.sh
```

### 3. Update runtime pins as one set

When changing Node or pnpm, update all matching pins together:

```bash
rg -n "24\\.15\\.0|24\\.19\\.0|24\\.21\\.0|pnpm@10\\.24\\.0|pnpm: \\^10|node: \\^24|node: >=22|nodejs >= 24|nodejs>=24|core24|24\\.08" \
  package.json gen-docs/package.json bin/duplicate-detector/package.json \
  Dockerfile Dockerfile.local devenv.nix devenv.lock .github .gitlab-ci.yml packaging charts
```

Then update the relevant files, reinstall each package universe, and rebuild any
Docker image digest pins that moved. For Docker digest updates, let Renovate
produce the digest PR when possible.

### 4. Update npm/pnpm dependencies

Root app:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm outdated
pnpm update --latest <package>
pnpm install
```

Docs app:

```bash
cd gen-docs
corepack enable
pnpm install --frozen-lockfile
pnpm outdated
pnpm update --latest <package>
pnpm install
```

Duplicate detector:

```bash
cd bin/duplicate-detector
corepack enable
pnpm install --frozen-lockfile
pnpm outdated
pnpm update --latest <package>
pnpm install
```

For override updates, first explain why the override exists, then check whether
the transitive dependency still resolves through the tree:

```bash
pnpm why <package>
```

Keep override-only changes separate from broad dependency bumps unless they
directly unblock the same update. Confidence: high.

### 5. Update automation and image dependencies

Prefer Renovate for:

- GitHub Actions refs and pinned digests.
- Dockerfile base image digests.
- Helm chart image references.
- Non-major pnpm dependency groups.

Manual updates are acceptable for GitLab-only images in `.gitlab-ci.yml`, smoke
test distro images, and deployment-only compose files. After updating automation
pins, run or inspect the matching workflow before merging.

### 6. Update packaging pins

For a release version change, update these surfaces together:

- `package.json` version.
- `charts/seerr-chart/Chart.yaml` chart `version` and `appVersion`.
- `packaging/snap/snapcraft.yaml` version.
- Debian/RPM/AUR metadata if the package version or runtime requirement changed.
- `packaging/smoke/project.env` only if image/repository names change.

Then run package-focused checks:

```bash
pnpm build
helm lint charts/seerr-chart
packaging/scripts/validate-aur-pkgbuild-hashes.sh
```

### 7. Validate the merged result

Run the full local validation set after product upstream merges or runtime
updates:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For docs changes:

```bash
cd gen-docs
pnpm build
```

For duplicate detector changes:

```bash
cd bin/duplicate-detector
pnpm detect --help
```

For container runtime changes:

```bash
docker build -t seerrng:sync-check .
```

### 8. Publish and mirror

Push the sync branch to the public fork and open a PR:

```bash
git push -u origin HEAD
```

After merge to `main`, mirror to GitLab only if the GitLab remote is used for
the next CI or deployment path:

```bash
git fetch origin main --tags
git push gitlab main --tags
```

Do not push upstream Seerr merge work directly to `upstream`.

## Decision Rules

- Merge `upstream/HEAD` into a sync branch, not straight into a dirty local
  branch. Confidence: high.
- Keep runtime pins aligned across Node engine, Docker bases, GitHub workflow
  containers, release assets, and package recipes. Confidence: high.
- Treat `pnpm-workspace.yaml` overrides and `gen-docs/patches/*` as maintained
  forks of upstream dependency behavior. Confidence: high.
- Let Renovate handle digest-pinned Actions and Docker updates unless a security
  fix is urgent. Confidence: moderate.
- Keep product upstream merges, broad dependency updates, and release packaging
  version bumps in separate PRs unless one change requires the other. Confidence:
  high.
