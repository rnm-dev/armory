# Playwright

Armory MCP package for browsing and testing HTTP(S) websites. It drives an operator-installed Chrome or Chromium browser in
headless mode and does not require credentials or write to the tested project.

## Browser requirement

Armory V1 does not yet accept package dependency declarations, so this initial
version discovers Chrome or Chromium in a standard location:

- macOS: `/Applications/Google Chrome.app` or `/Applications/Chromium.app`
- Linux: `/usr/bin/google-chrome` or `/usr/bin/chromium`

The Playwright browser profile is temporary, lives below `PEON_ARMORY_HOME`,
and is removed when the browser session closes.

## Tools

- `navigate`: open any HTTP(S) URL
- `snapshot`: return a YAML accessibility snapshot
- `wait_for`: wait for a selector state
- `click`: click a selected element
- `fill`: replace a form control value
- `text_content`: read a selected element's text
- `screenshot`: return a PNG page capture
- `close`: discard the browser session and its profile

The package declares unrestricted network access so pages and their subresources
can load from external hosts. Navigation remains limited to HTTP(S) URLs.
