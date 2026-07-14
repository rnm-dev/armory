# Archive fixtures

`generated/` contains deterministic tarballs produced by `generate.mjs`. They cover
a valid single-root package plus path traversal, escaping symbolic/hard links,
duplicate normalized paths, expanded-size enforcement, malformed manifests, MCP
startup crashes, startup timeouts, oversized output, and malformed, duplicate-result,
and timeout hook processes. The adjacent checksum is intentionally wrong.
`limits.json` supplies a small test limit so size handling can be exercised without
committing a huge file.

Regenerate with `npm run generate:fixtures`. Repository validation fails when the
checked-in bytes do not match the generator.
