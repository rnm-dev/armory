# Google Analytics

Armory package for complete Google Analytics API access through MCP. It combines focused reporting tools with guarded REST gateways so new Google endpoints are usable without waiting for a package release.

## Capabilities

- GA4 core, realtime, funnel, pivot, batch, compatibility, metadata, audience-export, and recurring-audience Data API operations
- Admin API alpha and beta resources, including accounts, properties, access bindings, data streams, key events, audiences, custom definitions, attribution and retention, annotations, subproperties, rollups, and Google product links
- GA4 and legacy user-data deletion
- Measurement Protocol validation and event collection, with global and EU endpoints

## Credentials

Enable the Google Analytics Data API and Google Analytics Admin API in a Google Cloud project. The recommended setup is:

1. In Google Cloud Console, open **IAM & Admin > Service Accounts** and create or select a service account.
2. Open **Keys > Add key > Create new key > JSON** and download the credential. Paste the complete file into **Google credential JSON**.
3. Copy `client_email` from that file. In Google Analytics, open **Admin > Account access management** or **Property access management**, add that email, and grant only the roles Peon needs.
4. In Google Analytics, open **Admin > Property settings** and copy the numeric Property ID into **Default GA4 property ID** if a default is useful.

An `authorized_user` credential JSON containing `client_id`, `client_secret`, and `refresh_token` is also accepted when interactive user authorization is required. The refresh token must already have the necessary Analytics OAuth scopes.

For Measurement Protocol event collection:

1. Open **Google Analytics > Admin > Data streams** and select the stream.
2. For a web stream, copy its `G-...` Measurement ID. For an app stream, copy the Firebase App ID from **Firebase Console > Project settings > Your apps**.
3. In the selected Analytics stream, open **Measurement Protocol API secrets**, create a secret, and copy its Secret value.
4. Configure the ID and secret together, then choose the global or EU collection endpoint.

The package requests the Analytics read, edit, and user-management scopes. The identity still receives only the permissions granted in Google Analytics.

Mutating Admin API calls, deletion requests, and event collection require `confirm: true`. Credentials are stored under `PEON_ARMORY_HOME` with mode `0600`, are never accepted as MCP arguments, and are never emitted in results or errors.

The generic `data_api_request` and `admin_api_request` tools take paths directly from Google's REST references. Responses over 2 MiB are rejected so callers must use the APIs' pagination and narrowing controls.
