# StartOS submission packet

The compiled StartOS wrapper is published at
https://github.com/snapetech/seerrng-startos.

- Package ID: `seerrng`
- Image: `docker.io/snapetech/seerrng:v3.27.1`
- Web UI: TCP `5055`
- Persistent data: `/app/config`

The wrapper passes the current Start9 SDK typecheck and `ncc` build. Start9's
marketplace submission is a human-gated review: send the wrapper repository URL
and this source repository to `submissions@start9labs.com`, including the
license and runtime-port details above.
