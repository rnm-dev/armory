# Armory

Official public package registry and package-source repository for Peon. Peon reads the static catalog from `armory.json`; published packages are immutable `.tar.gz` assets attached to GitHub Releases, never installed from the source tree.

## Technology and layout

- Node.js 22+ ESM repository written in TypeScript and JavaScript.
- `schemas/`: V1 JSON Schemas for the catalog, package manifests, and hook protocol.
- `src/generated/`: TypeScript contracts generated from those schemas; regenerate after schema changes.
- `packages/<package-id>/`: package source, tests, manifests, licenses, and bundled runtime output.
- `scripts/`: validation, type generation, deterministic archive building, and manual publishing.
- `tests/`: schema, package, hook-protocol, and hostile-archive coverage.
- `dist/`: locally built release archives; treat as generated output.

## Packages

- `heroboard`: production MCP integration for tracking projects, tasks, progress, and XP through `heroboard.app`; requires an API key.
- `fixture-echo`: test-only, deterministic, credential-free echo MCP package.
- `fixture-configured`: test-only package exercising text, secret, select, and file configuration plus configure/verify hooks.

Each package has two distinct metadata files:

- `armory.package.json`: versioned runtime/install manifest included in release archives.
- `catalog.package.json`: source-only display metadata consumed by the publisher and excluded from archives.

## Common workflows

```sh
npm ci
npm run generate:types
npm run check
npm run build:package -- <package-id>
```

`npm run check` validates schemas/catalog/manifests, type-checks, runs repository tests, and installs/builds/tests/audits every package. Package runtimes must bundle dependencies into `dist`; installation does not run `npm install`.

## Conventions and safety

- Package IDs are lowercase and match `^[a-z0-9][a-z0-9-]{0,62}$`; versions use strict SemVer.
- MCP servers communicate over stdio: protocol output only on stdout, diagnostics on stderr.
- Hooks use bounded NDJSON: one input, optional progress messages, then exactly one terminal result.
- Never echo or log configuration secrets, place them in CLI arguments/environment variables, or expose them in errors.
- Configuration should default to `PEON_ARMORY_HOME`; host writes require manifest declaration and explicit operator confirmation.
- Release archives must include `armory.package.json`, bundled `dist`, `LICENSE`, and `THIRD_PARTY_NOTICES`; `assets` is optional.
- Published versions and assets are immutable. Fixes require a new version.

## Publishing model

Publishing is a deliberate local maintainer workflow with no GitHub Actions, required PRs, branch protection, or remote required checks. A package release has two separate commits: the source release candidate first, then the generated catalog entry after the immutable GitHub Release exists.

### Release checklist

1. Preserve unrelated working-tree changes. Stage only the coherent package and contract changes intended for this release.
2. Commit and push the source release candidate to `main`. Before publishing, require a clean checkout where `main` matches `origin/main`.
3. Run the full release gates:

```sh
npm ci
npm run generate:types
npm run check
npm run build:package -- <package-id>
```

4. Inspect `dist/<package-id>-<version>.tar.gz`. It must contain one logical root plus `armory.package.json`, bundled `dist`, `LICENSE`, and `THIRD_PARTY_NOTICES`; `assets` is optional. Record its size and SHA-256.
5. Publish from the clean synchronized checkout:

```sh
npm run publish:package -- <package-id> --catalog-entry packages/<package-id>/catalog.package.json
```

6. The publisher creates the version tag and GitHub Release, uploads the archive, downloads it again, verifies size and SHA-256, and updates `armory.json` locally. It does not finish the catalog publication by itself.
7. Review the generated `armory.json` diff. Confirm package metadata, latest version, minimum Peon version, platforms, release URL, archive size, and SHA-256. Run `npm run validate` again.
8. Commit only the catalog update and push it directly to `main`:

```sh
git add armory.json
git commit -m "Publish <package-id> <version> catalog entry"
git push origin main
```

9. Verify the exact pushed commit and the public `armory.json`. Peon reports the package as available only after this catalog commit is public and its catalog cache refreshes. Raw GitHub `main` responses may briefly be cached, so verify the exact commit when needed.

Published versions, tags, and assets are immutable. Never rerun or replace an existing version; make fixes under a new SemVer version.
