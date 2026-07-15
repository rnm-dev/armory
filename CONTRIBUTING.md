# Contributing packages

Official packages live at `packages/<package-id>` and use lowercase IDs matching
`^[a-z0-9][a-z0-9-]{0,62}$`. Each package contains a versioned
`armory.package.json`, locked Node dependencies when applicable, source, tests, and
the runtime files required by the archive builder. A checked-in
`catalog.package.json` holds the package's catalog presentation fields for the
manual publisher; it is source metadata and is excluded from release archives.

## Runtime layout

The local build must produce:

```text
armory.package.json
catalog.package.json      # source-only release metadata
dist/mcp.js
dist/hooks/*.js
assets/                 # optional
LICENSE
THIRD_PARTY_NOTICES
```

Bundle runtime dependencies into `dist`; the installer never runs `npm install`.
MCP servers use stdio and write only protocol messages to stdout. Diagnostics go to
stderr. Tool names are package-local; Peon exposes them as
`armory__<toolPrefix>__<tool-name>`.

Hooks receive one NDJSON input message on stdin and return bounded progress messages
followed by one terminal result. Configuration values, especially secrets, must
never be echoed, logged, placed in arguments/environment variables, or returned in
errors. Configuration should default to `PEON_ARMORY_HOME`; host writes require a
manifest declaration and explicit operator confirmation.

Configuration fields require explicit `id`, `label`, `type`, and `required` values.
Use `secret` for credentials requiring masked input and redaction, `file` for
credential or configuration file input, and `select` only with a non-empty
`options` array. Other field types must not have `options`. Optional validation may
specify `pattern` and `maxLength`. Legacy boolean sensitivity flags are invalid
under strict V1 manifest validation; credential handling follows the field type.

## Local development

Use locked dependencies and provide package-level `build` and `test` scripts. Then
run the repository checks:

```sh
npm ci
npm run generate:types
npm run check
npm run build:package -- <package-id>
```

Versions are strict SemVer. Published versions and release assets are immutable; fix
a release by publishing a new version. Maintainers commit directly to `main`, but
must inspect the diff and complete the manual verification in `PUBLISHING.md` first.
