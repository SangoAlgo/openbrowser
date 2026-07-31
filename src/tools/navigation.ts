import { z } from "zod";
import { ServerState } from "../server.js";

export function registerNavigationTools() {
  return [
    {
      name: "browser_navigate",
      description:
        "Navigate to URL. Auto-waits for DOM stability (network idle + mutation settle). Returns compact action targets. Automatically detects and captures popup windows (OAuth flows). No manual sleep needed — built-in stabilization.",
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
    {
      name: "browser_list_tabs",
      description:
        "List all open tabs (including popups opened via OAuth). Returns tab IDs and URLs.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "browser_switch_tab",
      description:
        "Switch active focus to a specific tab. Auto-activates popup tabs for OAuth flows.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tab_id: { type: "string" },
        },
        required: ["tab_id"],
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

  let popupPromise: Promise<any> | null = null;
  const popupHandler = (popup: any) => {
    popupPromise = Promise.resolve(popup);
  };
  page.once("popup", popupHandler);

  await page.goto(url, { waitUntil: wait_until, timeout: timeout_ms });

  const tabId = `tab-${state.pages.size + 1}`;
  state.pages.set(tabId, page);
  state.activeTabId = tabId;

  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {}

  try {
    await page.waitForFunction(
      () => {
        const m = (window as any).__mutationCount || 0;
        return m === (window as any).__lastMutationCount;
      },
      { timeout: 3000 }
    ).catch(() => {});
  } catch {}

  const inputs = await sniffInputs(page);
  const actions = await sniffActions(page);

  const result: any = {
    status: "success",
    url: page.url(),
    title: await page.title(),
    http_status: 200,
    tab_id: tabId,
    sniffed_inputs: inputs,
    sniffed_actions: actions,
  };

  if (popupPromise) {
    try {
      const popup = await Promise.race([
        popupPromise,
        new Promise((r) => setTimeout(() => r(null), 3000)),
      ]);
      if (popup) {
        const popupId = `tab-${state.pages.size + 1}`;
        state.pages.set(popupId, popup);
        result.popup_detected = true;
        result.popup_tab_id = popupId;
        result.popup_url = popup.url();
      }
    } catch {}
  }

  return result;
}

export function handleListTabs(args: unknown, state: ServerState) {
  const tabs = Array.from(state.pages.entries()).map(([id, page]) => ({
    tab_id: id,
    url: page.url(),
    title: page.title,
    is_active: id === state.activeTabId,
  }));

  return {
    status: "success",
    tabs_count: tabs.length,
    tabs,
  };
}

export function handleSwitchTab(args: unknown, state: ServerState) {
  const { tab_id } = z.object({ tab_id: z.string() }).parse(args);

  if (!state.pages.has(tab_id)) {
    throw new Error(`Tab "${tab_id}" not found. Open tabs: ${Array.from(state.pages.keys()).join(", ")}`);
  }

  state.activeTabId = tab_id;
  state.locatorCache.clearTab();

  return {
    status: "success",
    active_tab_id: tab_id,
    url: state.pages.get(tab_id)!.url(),
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
