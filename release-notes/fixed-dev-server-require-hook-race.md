---
category: fixed
audience: developers
area: developer-experience
action: none
breaking: false
---
`pnpm dev` no longer crashes on startup with "Cannot find module '@server/entity/IssueComment'" (or a similar error for a different module) — a race between Next.js's require-hook and the `@server/*` path-alias resolver, triggered whenever TypeORM's directory-based loaders or the settings migrator resolved files dynamically after Next's dev server was constructed. Database and settings initialization now runs before Next installs its hook.
