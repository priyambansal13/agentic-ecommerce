# Changesets

Versioned libraries (`libs/*`). Published ones (`@ac/contracts`, `@ac/money`) are consumed by the frontend
repo from the registry; internal ones (`@ac/nest-common`, `@ac/kafka`) are `private` and only versioned.

    pnpm changeset          # describe the change (patch / minor / major)
    pnpm libs:version       # apply versions + changelogs
    pnpm libs:publish       # publish new versions (local: Verdaccio via `ac libs publish`; CI: GitHub Packages)
