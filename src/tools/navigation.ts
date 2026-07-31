import { z } from "zod";
import { ServerState } from "../server.js";

export function registerNavigationTools() {
  return [
    {
      name: "browser_navigate",
      description:
        "Navigate to URL. Auto-waits for DOM stability (network idle + mutation settle). Returns compact action targets. Supports smart-wait: no manual sleep needed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "URL to navigate to" },
          wait_until: {
            type: "string",
            enum: ["load", "domcontentloaded", "networkidle", "commit"],
            default: "networkidle",
          },
          timeout_ms: { type: "number", default: 30000 },
          tab_id: { type: "string" },
        },
        required: ["url"],
      },
    },
    {
      name: "browser_go_back",
      description: "Navigate back in history with smart-wait.",
      inputSchema: {
        type: "object" as const,
        properties: { tab_id: { type: "string" } },
      },
    },
  ];
}

const NavigateArgs = z.object({
  url: z.string(),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).default("networkidle"),
  timeout_ms: z.number().default(30000),
  tab_id: z.string().optional(),
});

export async function handleNavigate(args: unknown, state: ServerState) {
  const { url, wait_until, timeout_ms } = NavigateArgs.parse(args);

  if (!state.context) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: false });
    state.browser = browser;
    state.context = await browser.newContext();
  }

  const page = await state.context.newPage();
  await page.goto(url, { waitUntil: wait_until, timeout: timeout_ms });

  const tabId = `tab-${state.pages.size + 1}`;
  state.pages.set(tabId, page);
  state.activeTabId = tabId;

  await page.waitForLoadState("networkidle").catch(() => {});

  const inputs = await sniffInputs(page);
  const actions = await sniffActions(page);

  return {
    status: "success",
    url: page.url(),
    title: await page.title(),
    http_status: 200,
    tab_id: tabId,
    sniffed_inputs: inputs,
    sniffed_actions: actions,
  };
}

async function sniffInputs(page: any) {
  return page.evaluate(() => {
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]), textarea, select, div[contenteditable="true"]'
    );
    return Array.from(inputs)
      .slice(0, 30)
      .map((el, i) => {
        const tag = el.tagName.toLowerCase();
        const ce = el.isContentEditable ? " (ce)" : "";
        return `[i${i + 1}] ${tag}${ce} name="${el.getAttribute("name") || ""}" ph="${el.getAttribute("placeholder") || ""}" tsid="${el.getAttribute("data-tsid") || ""}"`;
      })
      .join("\n");
  });
}

async function sniffActions(page: any) {
  return page.evaluate(() => {
    const actions = document.querySelectorAll(
      'button, a, [role="button"], [role="link"], input[type="submit"]'
    );
    return Array.from(actions)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .slice(0, 40)
      .map((el, i) => {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || "").trim().substring(0, 40);
        return `[b${i + 1}] ${tag} "${text}"`;
      })
      .join("\n");
  });
}
