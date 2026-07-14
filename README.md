# Armory

Armory is the official public package registry for Peon. It contains package source,
the static `armory.json` catalog, V1 JSON schemas, generated TypeScript contracts,
tests, and local build/release tooling.

Peon fetches the catalog from:

```text
https://raw.githubusercontent.com/rnm-dev/armory/main/armory.json
```

Package releases are immutable `.tar.gz` assets attached to GitHub Releases. Peon
never installs source directly from `main`.

## Local checks

```sh
npm ci
npm run check
```

This repository deliberately uses direct commits to `main`. It has no required pull
requests, branch protection, required checks, or CI workflows. Maintainers must run
the local checks before pushing or publishing.

See [CONTRIBUTING.md](CONTRIBUTING.md) for package authoring and
[PUBLISHING.md](PUBLISHING.md) for the manual release process.
