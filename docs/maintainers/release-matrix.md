# Release support matrix

This is the release system's explicit support boundary. A channel is listed only
when its workflow builds or publishes that artifact; a label in a generic smoke
test is not evidence of support.

The container image is the broadest distribution and is the authoritative
multi-architecture runtime:

| Surface | Channel or format | Architectures actually built | Publication |
| --- | --- | --- | --- |
| Container | GHCR and Docker Hub stable releases | `linux/amd64`, `linux/arm64` | Published and signed by `release.yml` |
| Container | GHCR `main` and `preview-*` | `linux/amd64`, `linux/arm64` | Published by CI/preview; not release-signed |
| Native archive | Linux tarball | `x64`, `arm64` | GitHub Release asset with SHA-256 sidecar |
| Native archive | macOS tarball | `arm64` | GitHub Release asset with SHA-256 sidecar |
| Native archive | Windows ZIP | `x64` | GitHub Release asset with SHA-256 sidecar |
| Linux package | Debian, RPM, AppImage | `amd64`/`x86_64` | GitHub Release asset with SHA-256 sidecar |
| Linux package | Launchpad PPA | `amd64` on Jammy and Noble | Published source builds |
| Linux package | COPR | `x86_64` Fedora chroots | COPR project `slskdn/seerrng` |
| Linux package | AUR `seerrng-bin` | `x86_64` | AUR package |
| Desktop bundle | Flatpak bundle attached to GitHub Release | `x86_64` | GitHub Release asset with SHA-256 sidecar; not a Flathub publication |
| Snap | Snap Store stable channel | `amd64` | Requires a current store credential; a failed upload is not a release |
| Kubernetes | Helm OCI chart | Uses the container image's `amd64`/`arm64` support | GHCR OCI registry |

The project does not currently publish native artifacts for Linux armv7/armhf,
Linux 32-bit, macOS x86_64, Windows arm64, or arm64 variants of the native
Linux package channels. Those are intentionally unsupported until each format
has a native build and post-publish smoke test. The package-smoke harness must
reject those combinations rather than imply that they exist.

The inherited Nix, Unraid, and Synology documentation describes upstream or
third-party installation paths; this repository has no corresponding package
publisher or release artifact for those channels.

GitHub Actions is the sole authoritative publisher and live deployer. GitLab CI
may build and scan an internal test image, but it must not deploy `seerr.home`
or promote an amd64-only image into the public registries.

For every tagged release, verify all of the following before calling the release
complete:

1. Both registries expose an OCI index containing exactly `linux/amd64` and
   `linux/arm64`.
2. The GitHub Release contains both native archive architectures and a valid
   SHA-256 sidecar for every archive, plus sidecars for Debian, RPM, AppImage,
   and Flatpak assets.
3. Every enabled package-channel workflow completed successfully and did not
   skip publication due to a missing credential.
4. The GitHub release body and Discord announcement contain the curated release
   notes.
