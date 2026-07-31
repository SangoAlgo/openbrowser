import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerClickTools } from "./tools/click.js";
import { registerCompactMapTools } from "./tools/compact-map.js";
import { registerDOMTools } from "./tools/dom-utils.js";
import { registerDeltaTools } from "./tools/delta.js";
import { registerSmartWaitTools } from "./tools/smart-wait.js";
import { registerAccessibilityTools } from "./tools/accessibility.js";
import { LocatorCache } from "./utils/locator-cache.js";

export interface ServerState {
  browser: Browser | null;
  context: BrowserContext | null;
  pages: Map<string, Page>;
  activeTabId: string | null;
  locatorCache: LocatorCache;
  deltaSnapshots: Map<string, string>;
}

export async function createServer(): Promise<{ server: Server; state: ServerState }> {
  const state: ServerState = {
    browser: null,
    context: null,
    pages: new Map(),
    activeTabId: null,
    locatorCache: new LocatorCache(),
    deltaSnapshots: new Map(),
  };

  const server = new Server(
    { name: "openbrowser", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        ...registerNavigationTools(),
        ...registerClickTools(),
        ...registerCompactMapTools(),
        ...registerDOMTools(),
        ...registerDeltaTools(),
        ...registerSmartWaitTools(),
        ...registerAccessibilityTools(),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!state.browser) {
      const instance = await chromium.launch({ headless: false });
      state.browser = instance;
      state.context = await instance.newContext();
    }

    const tabId = args?.tab_id as string | undefined;
    const page = tabId && state.pages.has(tabId)
      ? state.pages.get(tabId)!
      : state.pages.get(state.activeTabId || "") || state.pages.values().next().value;

    const needsPage = ![
      "browser_navigate",
      "browser_list_tabs",
      "browser_switch_tab",
    ].includes(name);

    if (needsPage && !page) {
      return {
        content: [{ type: "text", text: "No active page. Call browser_navigate first." }],
        isError: true,
      };
    }

    try {
      const result = await routeTool(name, args, state, page);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message || String(e) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return { server, state };
}

async function routeTool(
  name: string,
  args: any,
  state: ServerState,
  page: Page | undefined
): Promise<any> {
  const { handleNavigate, handleListTabs, handleSwitchTab } =
    await import("./tools/navigation.js");
  const { handleClick, handleForceClick, handleFill } =
    await import("./tools/click.js");
  const { handleCompactMap } = await import("./tools/compact-map.js");
  const {
    handleGetContent,
    handleEvaluateJS,
    handleScreenshot,
  } = await import("./tools/dom-utils.js");
  const { handleGetDelta } = await import("./tools/delta.js");
  const { handleSmartWait, handleWaitForNavigationOrPopup } =
    await import("./tools/smart-wait.js");
  const { handleGetAccessibilityTree, handleClickAccessibility } =
    await import("./tools/accessibility.js");

  switch (name) {
    case "browser_navigate":
      return handleNavigate(args, state);
    case "browser_list_tabs":
      return handleListTabs(args, state);
    case "browser_switch_tab":
      return handleSwitchTab(args, state);
    case "browser_click":
      return handleClick(args, state, page!);
    case "browser_force_click":
      return handleForceClick(args, state, page!);
    case "browser_fill":
      return handleFill(args, state, page!);
    case "browser_get_compact_map":
      return handleCompactMap(args, state, page!);
    case "browser_get_content":
      return handleGetContent(args, page!);
    case "browser_evaluate_js":
      return handleEvaluateJS(args, page!);
    case "browser_take_screenshot":
      return handleScreenshot(args, page!);
    case "browser_get_delta":
      return handleGetDelta(args, state, page!);
    case "browser_smart_wait":
      return handleSmartWait(args, state, page!);
    case "browser_wait_for_navigation_or_popup":
      return handleWaitForNavigationOrPopup(args, state, page!);
    case "browser_get_accessibility_tree":
      return handleGetAccessibilityTree(args, state, page!);
    case "browser_click_a11y":
      return handleClickAccessibility(args, state, page!);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
