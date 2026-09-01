# Google Play

Upload Android App Bundles and manage Google Play releases, store listings, screenshots, Data Safety declarations, and regional price previews from Peon through the Google Play Android Developer API.

## Setup

1. Enable the Google Play Android Developer API in a Google Cloud project.
2. Create a service account and download a JSON key.
3. In Google Play Console, invite the service account and grant it access to the apps and release permissions it should manage.
4. Configure this package with the JSON key.

Grant only the Play Console permissions you intend to automate. Release mutations require the exact `CONFIRM_RELEASE_CHANGE` confirmation value. Listing and image changes plus Data Safety submission require `CONFIRM_PLAY_CONSOLE_CHANGE`. Edit-backed mutations use a short-lived edit, validate it, and commit it atomically.
Every tool requires the Android `packageName` of the app to operate on; it is not stored as a package default.

## Tools

- `list_releases`: inspect current release lifecycle state for a track through a temporary edit.
- `list_tracks`: inspect all tracks through a temporary edit.
- `list_listings`: inspect all localized store listings through a temporary edit.
- `update_listing`: patch and publish a localized title, descriptions, or promo video URL.
- `list_images`: inspect screenshots and store graphics by locale and image type.
- `upload_image`: upload and publish a PNG or JPEG from an absolute path under `~/Projects`, with optional AI-generated-content attestation.
- `upload_bundle`: start an asynchronous streamed `.aab` upload under `~/Projects`; returns an operation ID immediately.
- `get_bundle_upload_status`: poll until the upload, edit validation, and commit succeed or fail.
- `delete_image`: remove and publish removal of a screenshot or store graphic.
- `update_data_safety`: submit the complete Data Safety CSV declaration. The Google API is write-only and does not expose the current declaration.
- `convert_region_prices`: preview region-specific prices from a tax-exclusive base price without changing a product.
- `promote_release`: add existing version codes to a target track as a draft, staged, or completed release.
- `update_rollout`: start, adjust, halt, or complete a release already active on a track.

Read-only edit tools delete their temporary edit afterward. Google Play policy questionnaires are not exposed by the Android Publisher API and remain manual Console work. Upload tools only read regular, non-symlink files selected under the declared `~/Projects` permission; APK upload is not supported.

### Image upload migration and safety

`upload_image` accepts only `filePath`. The former `imageBase64` argument was
removed in 0.3.0 and is not advertised as a compatibility alias: callers must
write generated or attached image bytes to a file under `~/Projects` and pass
its absolute path. This keeps image bytes out of MCP arguments and results.

The package opens the selected file once, verifies that its resolved path stays
under the authorized root, rejects direct symlinks and non-regular files,
enforces the decoded 15 MiB limit, validates PNG/JPEG signatures against the
extension, and detects replacement or mutation during the read. Upload results
contain only bounded image metadata (`id`, optional `sha256` and optional
`url`); file paths and image bytes are never returned.
