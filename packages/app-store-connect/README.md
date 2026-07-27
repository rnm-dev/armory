# App Store Connect

Automate TestFlight, App Store metadata, review, and release workflows from Peon through the App Store Connect API.

## Setup

1. For a team key, open **Users and Access > Integrations > App Store Connect API > Team Keys**. For an individual key, open your App Store Connect profile.
2. Create an API key with only the roles Peon needs.
3. Copy the Key ID and download the matching `.p8` private key. Apple permits downloading it only once.
4. For a team key, also copy the Issuer ID. Individual keys leave Issuer ID empty. The 10-character Apple Developer Team ID is not used.

The package creates short-lived ES256 authorization tokens locally. The private key is stored only in Peon's managed package home with owner-only permissions. Revoke the key in App Store Connect immediately if it may have been exposed.

## Tools

- `list_apps`: list apps visible to the API key, optionally filtered by bundle ID.
- `list_builds`: inspect uploaded builds, processing state, expiration, and encryption status.
- `list_app_store_versions`: inspect versions and App Store submission state across platforms.
- `list_beta_groups`: inspect TestFlight groups and their access settings.
- `add_builds_to_beta_group`: give a TestFlight group access to existing builds.
- `api_get`: call any read-only `/v1/` endpoint, including TestFlight, metadata, review, release, IAP, subscriptions, analytics, and future Apple resources.
- `api_mutate`: call any state-changing `/v1/` endpoint with explicit confirmation.

The dedicated TestFlight mutation requires `CONFIRM_TESTFLIGHT_CHANGE`; generic mutations require `CONFIRM_APP_STORE_CONNECT_CHANGE`. The package deliberately does not read arbitrary host files, so upload app binaries with Xcode, Transporter, or CI. Once uploaded, all API-managed testing and publishing steps are available.
