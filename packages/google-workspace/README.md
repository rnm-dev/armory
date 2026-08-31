# Google Workspace

Armory package for finding and editing Google Docs, Sheets, and Slides through their official APIs.

## Setup

You may reuse the service-account JSON key selected for the Google Play package. In that key's Google Cloud project, enable:

- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API

Share each file with the service account's `client_email`, just as you would share it with a person. For organization-wide access, a Google Workspace administrator must separately configure domain-wide delegation; this package does not impersonate a user. Files in a Shared Drive require the service account to be a member of that drive.

Google Play Console permissions are unrelated to Workspace file permissions. Reusing the key avoids creating another credential, but it does not grant access by itself.

All editing tools require the exact `CONFIRM_WORKSPACE_EDIT` confirmation value.
