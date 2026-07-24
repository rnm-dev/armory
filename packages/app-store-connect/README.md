# App Store Connect

Inspect App Store releases and manage TestFlight build access from Peon through the App Store Connect API.

## Setup

1. In App Store Connect, open **Users and Access > Integrations > App Store Connect API > Team Keys**.
2. Create a team API key with only the roles Peon needs.
3. Copy the Issuer ID and Key ID, then download the `.p8` private key. Apple permits downloading it only once.
4. Configure this package with those values. Optionally set a default app resource ID returned by `list_apps`.

The package creates short-lived ES256 authorization tokens locally. The private key is stored only in Peon's managed package home with owner-only permissions. Revoke the key in App Store Connect immediately if it may have been exposed.

## Tools

- `list_apps`: list apps visible to the API key, optionally filtered by bundle ID.
- `list_builds`: inspect uploaded builds, processing state, expiration, and encryption status.
- `list_app_store_versions`: inspect versions and App Store submission state across platforms.
- `list_beta_groups`: inspect TestFlight groups and their access settings.
- `add_builds_to_beta_group`: give a TestFlight group access to existing builds.

The TestFlight mutation requires the exact `CONFIRM_TESTFLIGHT_CHANGE` confirmation value. The package does not create apps or upload builds; use App Store Connect, Xcode, Transporter, or Apple's build upload APIs for those workflows.
