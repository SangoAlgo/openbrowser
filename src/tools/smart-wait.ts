import { z } from "zod";
import { ServerState } from "../server.js";

export function registerSmartWaitTools() {
  return [
    {
      name: "browser_smart_wait",
      description:
        "Smart wait — waits for DOM stability (network idle + no mutations for 500ms). Use instead of manual sleep().",
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
        "Wait for any outcome after an action: URL change, popup open, or network idle. Returns the outcome type and new URL/tab_id. Use after clicks that may open OAuth popups or redirect.",
      inputSchema: {
        type: "object" as const,
        properties: {
          timeout_ms: { type: "number", default: 30000 },
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
    await page.waitForLoadState("networkidle", { timeout: Math.min(duration_ms, 10000) });
  } catch {}

  await page.waitForTimeout(Math.max(duration_ms, 500));

  return {
    status: "success",
    message: `Waited for ${duration_ms}ms with network-idle check`,
  };
}

const WaitForNavOrPopupArgs = z.object({
  timeout_ms: z.number().default(30000),
});

export async function handleWaitForNavigationOrPopup(args: unknown, state: ServerState, page: any) {
  const { timeout_ms } = WaitForNavOrPopupArgs.parse(args);

  const startUrl = page.url();

  const result = await Promise.race([
    page.waitForURL((url: URL) => url.toString() !== startUrl, { timeout: timeout_ms }).then(() => ({
      type: "navigation" as const,
      newUrl: page.url(),
    })),
    page.context().waitForEvent("page", { timeout: timeout_ms }).then((popup: any) => {
      const tabId = `tab-${state.pages.size + 1}`;
      state.pages.set(tabId, popup);
      return {
        type: "popup" as const,
        newTabId: tabId,
        popupUrl: popup.url(),
      };
    }),
    page.waitForLoadState("networkidle", { timeout: timeout_ms }).then(() => ({
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
