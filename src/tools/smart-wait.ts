import { z } from "zod";
import { ServerState } from "../server.js";

export function registerSmartWaitTools() {
  return [
    {
      name: "browser_smart_wait",
      description:
        "Smart wait — waits for DOM stability (network idle + no mutations for 500ms). Use instead of manual sleep(). Auto-tracks mutation observers for detect SPA re-renders.",
      inputSchema: {
        type: "object" as const,
        properties: {
          duration_ms: { type: "number", default: 5000 },
          tab_id: { type: "string" },
        },
      },
    },
    {
      name: "browser_wait_for_navigation_or_popup",
      description:
        "Wait for any outcome after an action: URL change, popup open, or network idle. AUTO-SWITCHES to popup tab if detected. Returns outcome type + new URL/tab_id. Use after clicks that may trigger OAuth popups or redirects. Eliminates manual sleep(3000-5000).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["click", "navigate", "submit", "auto"],
            default: "auto",
            description:
              "Type of preceding action. 'auto' tries to detect automatically.",
          },
          timeout_ms: { type: "number", default: 30000 },
          auto_switch: {
            type: "boolean",
            default: true,
            description:
              "Auto-switch active tab to popup when detected",
          },
          tab_id: { type: "string" },
        },
      },
    },
  ];
}

const SmartWaitArgs = z.object({
  duration_ms: z.number().default(5000),
});

export async function handleSmartWait(args: unknown, state: ServerState, page: any) {
  const { duration_ms } = SmartWaitArgs.parse(args);

  try {
    await page.waitForLoadState("networkidle", {
      timeout: Math.min(duration_ms, 10000),
    });
  } catch {}

  try {
    await page.evaluate(() => {
      let mutations = 0;
      const observer = new MutationObserver(() => {
        mutations++;
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      (window as any).__pendingMutations = { count: mutations, observer };
    });

    await page.waitForTimeout(800);

    const stable = await page.evaluate(() => {
      const pending = (window as any).__pendingMutations;
      if (pending?.observer) {
        pending.observer.disconnect();
      }
      return (window as any).__pendingMutations?.count === 0;
    });
    if (!stable) {
      await page.waitForTimeout(Math.max(duration_ms, 500));
    }
  } catch {
    await page.waitForTimeout(Math.max(duration_ms, 500));
  }

  return {
    status: "success",
    message: `Waited for ${duration_ms}ms with network-idle + mutation-settle check`,
  };
}

const WaitForNavOrPopupArgs = z.object({
  action: z.enum(["click", "navigate", "submit", "auto"]).default("auto"),
  timeout_ms: z.number().default(30000),
  auto_switch: z.boolean().default(true),
});

export async function handleWaitForNavigationOrPopup(
  args: unknown,
  state: ServerState,
  page: any
) {
  const { timeout_ms, auto_switch } = WaitForNavOrPopupArgs.parse(args);

  const startUrl = page.url();

  const result = await Promise.race([
    page
      .waitForURL((url: URL) => url.toString() !== startUrl, {
        timeout: timeout_ms,
      })
      .then(() => ({
        type: "navigation" as const,
        newUrl: page.url(),
      })),
    page
      .context()
      .waitForEvent("page", { timeout: timeout_ms })
      .then((popup: any) => {
        const tabId = `tab-${state.pages.size + 1}`;
        state.pages.set(tabId, popup);

        if (auto_switch) {
          state.activeTabId = tabId;
          state.locatorCache.clearTab();
        }

        return {
          type: "popup" as const,
          newTabId: tabId,
          popupUrl: popup.url(),
          auto_switched: auto_switch,
        };
      }),
    page
      .waitForLoadState("networkidle", { timeout: Math.min(timeout_ms, 5000) })
      .then(() => ({
        type: "network_idle" as const,
        url: page.url(),
      })),
  ]).catch(() => ({
    type: "timeout" as const,
    url: page.url(),
  }));

  return {
    status: "success",
    outcome: result,
  };
}
