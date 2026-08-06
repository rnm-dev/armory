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

Credentialed packages also declare the reusable profile they accept at the
top level of `armory.package.json`:

```json
"profile": {
  "type": "google-service-account",
  "requiredFields": ["serviceAccountJson"]
}
```

Profile types are semantic compatibility identifiers matching
`^[a-z][a-z0-9.-]{0,63}$`; they are chosen deliberately and are never inferred
from package IDs. Packages that can share one credential record use the exact
same profile type and the same field IDs for the same values. A shared field ID
must keep a compatible field type, options, and validation rules in every
package that uses it.

`requiredFields` contains each configuration field whose `required` value is
`true`, with no duplicates, and every entry must name a field declared in the
same manifest. The field declarations remain the form and validation source;
the profile declaration does not duplicate a field schema or contain values.
Optional package settings remain configuration fields but are not profile
assignment prerequisites. Credential-free packages omit `profile` entirely.
Inventory, logs, errors, and documentation may expose only the profile type and
field IDs, never submitted credential values or derived credential details.

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
