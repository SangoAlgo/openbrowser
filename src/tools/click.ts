import { z } from "zod";
import { ServerState } from "../server.js";

export function registerClickTools() {
  return [
    {
      name: "browser_click",
      description:
        "Click element by CSS, XPath, text, role=role[name='...'], or ref (from compact map). Auto-fallback: Playwright click -> JS click on visibility/overlay errors -> a11y role+name search. Accepts ref='e5' from compact_map — uses cached stable locator (data-tsid, aria-label, role+name).",
      inputSchema: {
        type: "object" as const,
        properties: {
          selector: {
            type: "string",
            description:
              "CSS, XPath, text selector, role=role[name='...'], or ref ID (e.g. 'e5'). Role patterns: 'role=link[name=\"Google\"]', 'role=button[name=\"Next\"]'.",
          },
          button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
          click_count: { type: "number", default: 1 },
          force: {
            type: "boolean",
            default: false,
            description:
              "Force JS click even if element is invisible/overlayed",
          },
          timeout_ms: { type: "number", default: 10000 },
          tab_id: { type: "string" },
        },
        required: ["selector"],
      },
    },
    {
      name: "browser_force_click",
      description:
        "Force-click element via JS — bypasses visibility, overlays, and pointer-event interception. Accepts same selector types as browser_click.",
      inputSchema: {
        type: "object" as const,
        properties: {
          selector: { type: "string" },
          tab_id: { type: "string" },
        },
        required: ["selector"],
      },
    },
    {
      name: "browser_fill",
      description:
        "Fill input field or contenteditable div. Auto-detects element type: standard inputs use Playwright fill(), contenteditable divs use execCommand('insertText') + input event dispatch for web-component compatibility.",
      inputSchema: {
        type: "object" as const,
        properties: {
          selector: { type: "string" },
          value: { type: "string" },
          timeout_ms: { type: "number", default: 10000 },
          tab_id: { type: "string" },
        },
        required: ["selector", "value"],
      },
    },
  ];
}

const ClickArgs = z.object({
  selector: z.string(),
  button: z.enum(["left", "right", "middle"]).default("left"),
  click_count: z.number().default(1),
  force: z.boolean().default(false),
  timeout_ms: z.number().default(10000),
  tab_id: z.string().optional(),
});

export async function handleClick(args: unknown, state: ServerState, page: any) {
  const { selector, force, timeout_ms } = ClickArgs.parse(args);

  const resolved = resolveRef(selector, state);

  if (force) {
    await forceClickElement(page, resolved);
    return { status: "success", method: "force-js-click" };
  }

  try {
    await page.click(resolved, { timeout: timeout_ms });
    return { status: "success", method: "playwright-click" };
  } catch (e: any) {
    const isVisibilityError =
      e.message?.includes("not visible") ||
      e.message?.includes("intercepts pointer events") ||
      e.message?.includes("not enabled");

    if (isVisibilityError) {
      try {
        await forceClickElement(page, resolved);
        return { status: "success", method: "fallback-js-click" };
      } catch {}
    }

    try {
      await clickByA11y(page, resolved);
      return { status: "success", method: "fallback-a11y-click" };
    } catch {
      throw e;
    }
  }
}

export async function handleForceClick(args: unknown, state: ServerState, page: any) {
  const { selector } = ClickArgs.parse(args);
  const resolved = resolveRef(selector, state);
  await forceClickElement(page, resolved);
  return { status: "success" };
}

const FillArgs = z.object({
  selector: z.string(),
  value: z.string(),
  timeout_ms: z.number().default(10000),
  tab_id: z.string().optional(),
});

export async function handleFill(args: unknown, state: ServerState, page: any) {
  const { selector, value, timeout_ms } = FillArgs.parse(args);
  const resolved = resolveRef(selector, state);

  try {
    await page.fill(resolved, value, { timeout: timeout_ms });
    return { status: "success" };
  } catch {
    await page.evaluate(
      ({ sel, val }: { sel: string; val: string }) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (!el) return;

        if (el.isContentEditable) {
          el.focus();
          document.execCommand("selectAll", false);
          document.execCommand("insertText", false, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement
        ) {
          (el as HTMLInputElement).value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      { sel: resolved, val: value }
    );
    return { status: "success", method: "js-fill" };
  }
}

function resolveRef(selector: string, state: ServerState): string {
  if (/^e\d+$/i.test(selector)) {
    const cached = state.locatorCache.resolve(selector);
    if (cached) return cached;
  }
  return selector;
}

async function forceClickElement(page: any, selector: string) {
  const clicked = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.click();
      return true;
    }
    return false;
  }, selector);

  if (!clicked && selector.startsWith("role=")) {
    const match = selector.match(/^role=([a-z]+)\[name="(.+)"\]$/i);
    if (match) {
      const [, role, name] = match;
      await page.evaluate(
        ({ r, n }: { r: string; n: string }) => {
          const all = document.querySelectorAll(
            `[role="${r}"], ${r}, a, button, [role="button"], [role="link"]`
          );
          for (const el of all) {
            const label =
              el.getAttribute("aria-label") ||
              (el.textContent || "").trim();
            if (label === n || label.includes(n)) {
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        },
        { r: role, n: name }
      );
    }
  }
}

async function clickByA11y(page: any, selector: string) {
  const match = selector.match(/^role=([a-z]+)\[name="(.+)"\]$/i);
  if (!match) return;

  const [, role, name] = match;

  await page.locator(`role=${role}[name="${name}"]`).first().click({ timeout: 5000 });
}
