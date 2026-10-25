---
name: contracts-release
description: "Use when versioning and publishing the shared backend libraries consumed across repos in agentic-commerce (@ac/contracts, @ac/money) — Changesets, semver rules, publishing to the local Verdaccio registry or GitHub Packages, and upgrading the frontend (and other consumers). Trigger on \"publish contracts\", \"bump @ac/contracts\", \"frontend needs the new DTO\", \"release libs\"."
---

# Release shared contracts

`@ac/contracts` (zod DTOs, CloudEvents `Events`, `TOPICS`) and `@ac/money` are the **only** code shared
between repos. They are versioned with Changesets in the backend repo and consumed by the frontend from
a registry: Verdaccio locally (`http://localhost:54873`), GitHub Packages in CI.

## 1. Version (backend repo)
```bash
cd backend
pnpm changeset            # pick @ac/contracts / @ac/money; patch = fix, minor = additive, major = removal
pnpm changeset version    # bumps versions + CHANGELOG.md
pnpm install && pnpm turbo run build test --filter=./libs/*...   # libs + every service that uses them
```
Semver rules: new optional field / new schema / new event version = **minor**; removing or retyping =
**major** (only after the expand/contract migration in `cross-repo-change`).

## 2. Publish
```bash
node ../platform/scripts/ac.mjs libs publish      # local: publishes versions Verdaccio doesn't have yet
# CI (main): changesets action publishes to GitHub Packages
```
Published versions are immutable — never republish the same version with different content; bump again.

## 3. Upgrade consumers (frontend repo)
```bash
cd frontend
pnpm update @ac/contracts @ac/money      # or set the exact version in the zone/package package.json
pnpm build && pnpm test
```
Read the CHANGELOG; adapt code to new optional fields; Playwright through the shell for affected zones.
Frontend registry config: `.npmrc` `@ac:registry=http://localhost:54873/` locally; CI points the
scope at GitHub Packages. pnpm's minimum-release-age policy excludes `@ac/*` in the frontend workspace.

## 4. Backend services
Services use the libs via the workspace (`workspace:^`), so they always build against the current
version; the version number matters for external consumers and changelogs.

## Checklist
- [ ] Changeset with the right bump level; CHANGELOG entry readable
- [ ] Libs + dependent services build and test
- [ ] Published (Verdaccio locally / GitHub Packages in CI); never republished in place
- [ ] Frontend upgraded deliberately and builds; affected zones tested
