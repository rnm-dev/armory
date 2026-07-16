import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { z } from "zod";

const BROWSER_PATHS = process.platform === "darwin"
  ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function localUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only http(s) URLs on localhost or 127.0.0.1 are allowed");
  }
  return url;
}

async function browserExecutable(): Promise<string> {
  for (const candidate of BROWSER_PATHS) {
    if (await fs.access(candidate, fs.constants.X_OK).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error(`Chrome or Chromium was not found; checked: ${BROWSER_PATHS.join(", ")}`);
}

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");

let context: BrowserContext | undefined;
let page: Page | undefined;
const profileDir = path.join(home, "runtime", `browser-profile-${process.pid}`);

async function currentPage(): Promise<Page> {
  if (!context) {
    await fs.rm(profileDir, { recursive: true, force: true });
    await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: await browserExecutable(),
      headless: true,
      chromiumSandbox: false,
      viewport: { width: 1280, height: 720 },
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url === "about:blank" || url.startsWith("data:")) return route.continue();
      try {
        localUrl(url);
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    page = context.pages()[0] ?? await context.newPage();
  }
  return page!;
}

async function closeBrowser(): Promise<void> {
  const active = context;
  context = undefined;
  page = undefined;
  await active?.close();
  await fs.rm(profileDir, { recursive: true, force: true });
}

const server = new McpServer({ name: "armory-playwright", version: "0.1.0" });

server.registerTool("navigate", {
  description: "Navigate the browser to a localhost URL and wait for the DOM to be ready.",
  inputSchema: { url: z.string().url().max(4096) },
}, async ({ url }) => {
  const target = localUrl(url).toString();
  const response = await (await currentPage()).goto(target, { waitUntil: "domcontentloaded" });
  return { content: [{ type: "text", text: JSON.stringify({ url: (await currentPage()).url(), status: response?.status() ?? null }) }] };
});

server.registerTool("snapshot", {
  description: "Return a YAML accessibility snapshot of the current page for inspection and element targeting.",
  inputSchema: {},
}, async () => ({ content: [{ type: "text", text: await (await currentPage()).locator("body").ariaSnapshot() }] }));

server.registerTool("wait_for", {
  description: "Wait for an element selected with a Playwright CSS or text selector.",
  inputSchema: {
    selector: z.string().min(1).max(2048),
    state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible"),
    timeoutMs: z.number().int().min(1).max(30000).default(5000),
  },
}, async ({ selector, state, timeoutMs }) => {
  await (await currentPage()).locator(selector).waitFor({ state, timeout: timeoutMs });
  return { content: [{ type: "text", text: JSON.stringify({ selector, state }) }] };
});

server.registerTool("click", {
  description: "Click one element selected with a Playwright CSS or text selector.",
  inputSchema: { selector: z.string().min(1).max(2048) },
}, async ({ selector }) => {
  await (await currentPage()).locator(selector).click();
  return { content: [{ type: "text", text: JSON.stringify({ clicked: selector }) }] };
});

server.registerTool("fill", {
  description: "Replace the value of an input, textarea, or contenteditable element.",
  inputSchema: { selector: z.string().min(1).max(2048), value: z.string().max(100000) },
}, async ({ selector, value }) => {
  await (await currentPage()).locator(selector).fill(value);
  return { content: [{ type: "text", text: JSON.stringify({ filled: selector }) }] };
});

server.registerTool("text_content", {
  description: "Return the text content of one selected element.",
  inputSchema: { selector: z.string().min(1).max(2048) },
}, async ({ selector }) => {
  const text = await (await currentPage()).locator(selector).textContent();
  return { content: [{ type: "text", text: text ?? "" }] };
});

server.registerTool("screenshot", {
  description: "Capture the current page as a PNG image.",
  inputSchema: { fullPage: z.boolean().default(false) },
}, async ({ fullPage }) => {
  const data = await (await currentPage()).screenshot({ type: "png", fullPage });
  return { content: [{ type: "image", data: data.toString("base64"), mimeType: "image/png" }] };
});

server.registerTool("close", {
  description: "Close the current browser session. The next browser tool starts a clean session.",
  inputSchema: {},
}, async () => {
  await closeBrowser();
  return { content: [{ type: "text", text: "Browser session closed" }] };
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void closeBrowser().finally(() => process.exit(0)); });
}
process.stdin.once("end", () => { void closeBrowser(); });

await server.connect(new StdioServerTransport());
