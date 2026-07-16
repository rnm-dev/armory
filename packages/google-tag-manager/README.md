# Google Tag Manager

Armory package for Google Tag Manager API v2 access through MCP. It provides focused account, container, workspace, entity, version, and publishing tools plus a guarded REST gateway for the complete API surface.

## Credentials

Enable the Tag Manager API in a Google Cloud project. The package accepts either:

- an `authorized_user` credential JSON containing `client_id`, `client_secret`, and `refresh_token`; or
- a `service_account` credential JSON whose `client_email` has been granted appropriate access in **Tag Manager > Admin > User Management**.

Paste the complete JSON into **Google credential JSON**. Optional default numeric account, container, and workspace IDs reduce repetition in tool calls. The container ID is the numeric API ID, not the public `GTM-...` identifier.

The package requests the official Tag Manager scopes for reading, container editing and deletion, account and user management, version editing, and publishing. Google Tag Manager still enforces the configured identity's permissions.

Every non-GET request through the generic gateway requires `confirm: true`. Creating a version and publishing also use dedicated confirmation-only tools. Test changes in a non-production account first: destructive GTM API operations do not provide interactive warnings or undo guarantees.

Credentials are stored under `PEON_ARMORY_HOME` with mode `0600`, never accepted as MCP tool arguments, and never emitted in results or errors. API responses over 2 MiB are rejected, so use pagination and narrow requests where needed.
