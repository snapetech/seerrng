# Co-op Cloud recipe draft

This directory contains a review-ready Co-op Cloud recipe draft for SeerrNG.
It uses the public Docker Hub image, Traefik for the web UI, and a named
volume for `/app/config`.

The recipe is not yet in the canonical `coop-cloud/apps` collection. Submit a
wishlist issue first, then copy this directory into the recipe repository after
the maintainers accept the app. The usual deployment flow is:

```sh
abra app new seerrng
abra app config seerrng.example.com
abra app deploy seerrng.example.com
```

The external `proxy` network and a reachable Docker Swarm host are required.
