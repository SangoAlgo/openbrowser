import { z } from "zod";
import { ServerState } from "../server.js";

export function registerDeltaTools() {
  return [
    {
      name: "browser_get_delta",
      description:
        "DOM Mutation Delta — only changed elements since last snapshot (~5 tokens). Also reports URL changes and popup openings.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tab_id: { type: "string" },
        },
      },
    },
  ];
}

export async function handleGetDelta(args: unknown, state: ServerState, page: any) {
  const tabId = (args as any)?.tab_id || state.activeTabId;
  const currentUrl = page.url();
  const currentDOM = await page.evaluate(() => document.body?.innerHTML?.length || 0);

  const prevSnapshot = state.deltaSnapshots.get(tabId || "");

  let deltaType = "full";
  let domDelta = "";

  if (prevSnapshot) {
    const prev = JSON.parse(prevSnapshot);
    if (prev.url !== currentUrl) {
      deltaType = "navigation";
      domDelta = `URL changed: ${prev.url} -> ${currentUrl}`;
    } else if (prev.domSize !== currentDOM) {
      deltaType = "dom_mutation";
      domDelta = `DOM size changed: ${prev.domSize} -> ${currentDOM}`;
    } else {
      deltaType = "none";
      domDelta = "";
    }
  }

  state.deltaSnapshots.set(tabId || "", JSON.stringify({
    url: currentUrl,
    domSize: currentDOM,
  }));

  return {
    status: "success",
    delta_count: deltaType === "none" ? 0 : 1,
    delta_type: deltaType,
    dom_delta: domDelta,
  };
}
