---
category: fixed
audience: operators
area: developer-experience
action: none
breaking: false
---
`pnpm dev` no longer crashes on startup with errors like "Cannot find module '@server/entity/IssueComment'" — a race between Next.js's require-hook and the `@server/*` path-alias resolver whenever TypeORM or the settings migrator resolved files dynamically after Next's dev server was constructed. Database and settings now initialize before Next installs its hook.
