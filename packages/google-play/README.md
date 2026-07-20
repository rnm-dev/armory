# Google Play

Manage Google Play release tracks from Peon through the Google Play Android Developer API.

## Setup

1. Enable the Google Play Android Developer API in a Google Cloud project.
2. Create a service account and download a JSON key.
3. In Google Play Console, invite the service account and grant it access to the apps and release permissions it should manage.
4. Configure this package with the JSON key and a default Android package name.

Grant only the Play Console permissions you intend to automate. Read operations inspect tracks and releases. Release mutations require the exact `CONFIRM_RELEASE_CHANGE` confirmation value, use a short-lived edit, validate it, and commit it atomically.

## Tools

- `list_releases`: inspect current release lifecycle state for a track.
- `list_tracks`: inspect all tracks through a temporary edit that is deleted afterward.
- `promote_release`: add existing version codes to a target track as a draft, staged, or completed release.
- `update_rollout`: start, adjust, halt, or complete a release already active on a track.

The package does not upload Android App Bundles or APKs and never reads arbitrary host files at runtime.
