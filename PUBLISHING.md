# Manual publishing

Armory releases are intentionally local maintainer operations. There are no GitHub
Actions workflows, required pull requests, branch protection rules, or required
remote checks.

Before publishing, use a clean `main` checkout that exactly matches `origin/main`:

```sh
npm ci
npm run check
npm run build:package -- <package-id>
```

Inspect the package tests, compiled runtime, archive root, file list, modes, license
notices, and manifest permissions. Ensure the package's committed
`catalog.package.json` contains `id`, `displayName`, `summary`, `publisher`,
`documentationUrl`, and the three boolean `requirements` fields. Then run:

```sh
npm run publish:package -- <package-id> --catalog-entry packages/<package-id>/catalog.package.json
```

The publisher refuses a dirty/non-current checkout or an existing tag/version. It
builds the package, creates `<package-id>-v<version>`, uploads the release asset,
downloads it again, verifies size and SHA-256, and only then updates and validates
`armory.json`. Review that catalog diff, commit it directly to `main`, and push.

Repository write access, the maintainer machine, GitHub credentials, and release
credentials are the V1 publisher trust boundary. A checksum detects corruption but
cannot establish authenticity if an attacker can replace both catalog and asset.
