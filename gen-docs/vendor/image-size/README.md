# image-size

This is a small, local security backport for the documentation build. It is
based on the `image-size` 2.0.2 distribution and rejects zero-length ICNS,
HEIF, and JXL records before their parsers can enter an infinite loop.

The package keeps the upstream API and has no SeerrNG-specific behavior. It can
be removed when `image-size` publishes a release containing the same fixes.
