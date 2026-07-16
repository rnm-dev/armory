# Playwright

Armory MCP package for testing web applications running on `localhost` or
`127.0.0.1`. It drives an operator-installed Chrome or Chromium browser in
headless mode and does not require credentials or write to the tested project.

## Browser requirement

Armory V1 does not yet accept package dependency declarations, so this initial
version discovers Chrome or Chromium in a standard location:

- macOS: `/Applications/Google Chrome.app` or `/Applications/Chromium.app`
- Linux: `/usr/bin/google-chrome` or `/usr/bin/chromium`

The Playwright browser profile is temporary, lives below `PEON_ARMORY_HOME`,
and is removed when the browser session closes.

## Tools

- `navigate`: open an HTTP(S) localhost URL
- `snapshot`: return a YAML accessibility snapshot
- `wait_for`: wait for a selector state
- `click`: click a selected element
- `fill`: replace a form control value
- `text_content`: read a selected element's text
- `screenshot`: return a PNG page capture
- `close`: discard the browser session and its profile

Requests to non-local hosts are blocked both at the MCP tool boundary and by
the browser context's request routing.
