---
name: publish-armory-package
description: Publish or prepare new Armory packages and immutable package updates through the repository's manual two-commit release workflow. Use for adding a production package, bumping an existing package version, building and inspecting a release archive, creating the GitHub tag and Release, updating armory.json, or verifying that a package release is publicly available.
---

# Publish Armory Package

Use the repository scripts as the source of release behavior. Keep package source, the immutable GitHub Release, and the generated catalog entry as three distinct states.

## Establish scope and authority

1. Extract the package ID, intended version, and whether the request is preparation-only or an actual publication.
2. Treat requests to prepare, validate, build, inspect, or review as non-publishing work. Do not commit, push, tag, create a Release, or edit `armory.json` manually.
3. Treat an explicit request to publish or release as authority to complete both release commits, pushes, the GitHub Release, and verification. If the request is ambiguous, ask before causing those external changes; in an unattended run, stop and report the missing authority.
4. Never publish a package whose `catalog.package.json` has `testOnly: true`.
5. Never replace, delete, or rerun an existing version, tag, or release. Make every correction under a new strict SemVer version.

## Inspect before changing

Run these checks first:

```sh
git status --short
git branch --show-current
git fetch origin main --tags
git rev-parse HEAD
git rev-parse origin/main
```

Preserve unrelated work. Do not stage, modify, discard, or commit unrelated paths. Publication itself requires a clean `main` exactly matching `origin/main`; if unrelated changes prevent that, stop before publishing and report them.

Determine the release kind from `armory.json`:

- New package: no entry with the package ID exists.
- Update: an entry exists; require the new manifest version to be greater than the current `latest` and absent from its `versions` array.

Also check that `packages/<id>/armory.package.json`, `catalog.package.json`, and any package `package.json` identify the intended package and version consistently. Refresh `package-lock.json` when package metadata or dependencies change.

## Prepare package source

For a new package, require at least:

```text
packages/<id>/
├── armory.package.json
├── catalog.package.json
├── dist/
├── LICENSE
└── THIRD_PARTY_NOTICES
```

Include `package.json`, `package-lock.json`, source, tests, hooks, and `assets/icon.png` when applicable. Package IDs must match `^[a-z0-9][a-z0-9-]{0,62}$`. `catalog.package.json` is source-only; do not place it in the release archive.

For an update:

- Bump `armory.package.json.version` to a new strict SemVer.
- Keep the package manager version and lockfile version aligned when the package has them.
- Update catalog display metadata only when intentionally changing the public listing.
- Rebuild bundled runtime output. Installation must not depend on running `npm install`.

Enforce the repository's protocol and security invariants: MCP stdout contains protocol messages only; diagnostics go to stderr; hooks emit bounded NDJSON with exactly one terminal result; secrets never appear in arguments, environment variables, logs, or errors; host writes require a manifest declaration and operator confirmation.

## Run release gates

From the repository root, run all gates in order:

```sh
npm ci
npm run generate:types
npm run check
npm run build:package -- <id>
```

Do not skip a failing gate. Diagnose preparation failures, but do not weaken schemas, validation, tests, package audits, or publishing safeguards merely to pass the release.

Inspect `dist/<id>-<version>.tar.gz` before any publication:

```sh
tar -tzf dist/<id>-<version>.tar.gz
shasum -a 256 dist/<id>-<version>.tar.gz
wc -c < dist/<id>-<version>.tar.gz
```

Require one logical archive root containing `armory.package.json`, bundled `dist`, `LICENSE`, and `THIRD_PARTY_NOTICES`; `assets` is optional. Reject absolute paths, traversal paths, symlinks, unexpected source metadata, secrets, or credentials. Record size and SHA-256 in the work summary.

## Commit the source release candidate

Skip this section for preparation-only requests.

Review all changes, then stage only the coherent package and contract changes for this version. Do not stage the top-level generated archive or an unrelated pre-existing change.

```sh
git diff -- <intended-paths>
git add <intended-paths>
git diff --cached --check
git diff --cached
git commit -m "Release <id> <version>"
git push origin main
git fetch origin main --tags
```

Before publishing, require all of the following:

```sh
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

If the package source was already committed and pushed, verify that the current clean commit contains exactly the intended release candidate instead of creating a redundant commit.

## Create the immutable release

For an explicitly authorized end-to-end release, use the guarded task. It runs the full release gates, calls the publisher, creates and pushes the catalog-only commit, and verifies the public exact-commit catalog. `--confirm` is required because the GitHub Release is immutable:

```sh
npm run release:package -- <id> --confirm
```

Use the manual steps below when the release needs inspection or intervention between phases.

Run the publisher exactly once:

```sh
npm run publish:package -- <id> --catalog-entry packages/<id>/catalog.package.json
```

The publisher validates and rebuilds the package, refuses an existing `<id>-v<version>` tag or Release, creates the GitHub Release, uploads and downloads the archive, verifies its size and SHA-256, and updates `armory.json` locally.

If it fails before creating the Release, fix the source under a new source commit as appropriate and rerun only when no tag or Release exists. If it fails after creating the Release, do not delete, overwrite, or rerun that version. Report the exact partial state and prepare a new version for any correction.

## Publish the catalog commit

Review the `armory.json` diff. Confirm the ID and display metadata, `latest`, version, minimum Peon version, platforms, release URL, archive size, SHA-256, requirements summary, and `updatedAt`. For an update, preserve all earlier immutable versions.

```sh
npm run validate
git status --short
git diff -- armory.json
git add armory.json
git diff --cached --check
git diff --cached
git commit -m "Publish <id> <version> catalog entry"
git push origin main
```

The second commit must contain only `armory.json`. If any other path is staged or modified unexpectedly, stop and investigate.

## Verify public availability

Fetch the pushed state and record the exact catalog commit:

```sh
git fetch origin main
git rev-parse origin/main
git show --stat --oneline origin/main
gh release view <id>-v<version> --repo rnm-dev/armory
```

Read `armory.json` at that exact commit through the GitHub API and confirm the package version, URL, size, and SHA-256. Prefer the commit-addressed API response because raw `main` may be briefly cached. Report that Peon availability begins only after this catalog commit is public and Peon's catalog cache refreshes.

## Report the result

For preparation-only work, report changed files, gate results, archive path, size, SHA-256, and every remaining publication step.

For a completed publication, report the version tag, GitHub Release URL, source commit, catalog commit, archive size and SHA-256, validation results, and exact-commit catalog verification. Clearly report any partial publication state; never imply success when only the GitHub Release or only the local catalog update exists.
