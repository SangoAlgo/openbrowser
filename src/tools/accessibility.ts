import { z } from "zod";
import { ServerState } from "../server.js";

interface A11yNode {
  ref: string;
  role: string;
  name: string;
  description: string;
  value: string;
  level: number;
  focused: boolean;
  disabled: boolean;
  checked: string;
  expanded: boolean;
  selected: boolean;
  hasPopup: string;
  children: A11yNode[];
}

export function registerAccessibilityTools() {
  return [
    {
      name: "browser_get_accessibility_tree",
      description:
        "Accessibility tree snapshot. Accepts scope parameter to filter by region (e.g. scope='left-panel', scope='navigation'). Returns compact tree with aN ref IDs. Ref IDs are cacheable — can be used in browser_click_a11y for elements invisible to DOM (portals, overlays).",
      inputSchema: {
        type: "object" as const,
        properties: {
          tab_id: { type: "string" },
          scope: {
            type: "string",
            description:
              "CSS selector to scope the a11y tree to a specific region. Only elements INSIDE this region are returned. Example: '#left-panel', '[role=\"navigation\"]', '.toolbar'.",
          },
          max_depth: { type: "number", default: 3, description: "Maximum nesting depth (1-5)" },
          max_elements: { type: "number", default: 40, description: "Max elements to return" },
        },
      },
    },
    {
      name: "browser_click_a11y",
      description:
        "Click element by accessibility-tree reference (e.g. 'a3' from browser_get_accessibility_tree). Uses Playwright's accessibility snapshot API — works even for elements invisible to DOM queries (React portals, shadow DOM, off-screen but a11y-visible). Falls back to role+name locator if ref cache is stale.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ref: {
            type: "string",
            description: "Accessibility tree ref ID, e.g. 'a3'. Auto-resolved from LocatorCache if previously seen.",
          },
          role: {
            type: "string",
            description: "Optional explicit ARIA role (e.g. 'link', 'button'). Used as fallback.",
          },
          name: {
            type: "string",
            description: "Optional explicit accessible name. Used with role as fallback locator.",
          },
          tab_id: { type: "string" },
        },
        required: ["ref"],
      },
    },
  ];
}

const A11yTreeArgs = z.object({
  tab_id: z.string().optional(),
  scope: z.string().optional(),
  max_depth: z.number().default(3),
  max_elements: z.number().default(40),
});

export async function handleGetAccessibilityTree(
  args: unknown,
  state: ServerState,
  page: any
) {
  const { scope, max_depth, max_elements } = A11yTreeArgs.parse(args);

  const snapshot = await page.accessibility.snapshot({
    interestingOnly: true,
    root: scope ? await page.locator(scope).first().elementHandle().catch(() => null) : undefined,
  });

  const nodes: { flat: A11yNode[]; count: number } = { flat: [], count: 0 };

  function walk(node: any, depth: number) {
    if (!node || nodes.count >= max_elements || depth > max_depth) return;

    const a11yNode: A11yNode = {
      ref: `a${nodes.count + 1}`,
      role: node.role || "generic",
      name: (node.name || "").trim().substring(0, 80),
      description: (node.description || "").substring(0, 80),
      value: node.value || "",
      level: depth,
      focused: node.focused || false,
      disabled: node.disabled || false,
      checked: node.checked || "",
      expanded: node.expanded || false,
      selected: node.selected || false,
      hasPopup: node.haspopup || "",
      children: [],
    };

    nodes.flat.push(a11yNode);
    nodes.count++;

    state.locatorCache.setA11y(a11yNode.ref, {
      role: a11yNode.role,
      name: a11yNode.name,
    });

    if (node.children) {
      for (const child of node.children) {
        if (nodes.count >= max_elements) break;
        walk(child, depth + 1);
      }
    }
  }

  walk(snapshot, 1);

  const scopeInfo = scope
    ? `Scoped to: "${scope}". `
    : "";

  const lines = nodes.flat.map((n) => {
    const indent = "  ".repeat(n.level - 1);
    const label = n.name
      ? `"${n.name}"`
      : n.value
        ? `v="${n.value}"`
        : "";
    const info = [
      n.disabled ? "[disabled]" : "",
      n.focused ? "[focused]" : "",
      n.expanded ? "[expanded]" : "",
      n.selected ? "[selected]" : "",
      n.checked ? `[${n.checked}]` : "",
      n.hasPopup ? `[haspopup:${n.hasPopup}]` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `${indent}[${n.ref}] ${n.role} ${label} ${info}`.trim();
  });

  return {
    status: "success",
    total_elements: nodes.count,
    scope: scope || "full-page",
    accessibility_tree: scopeInfo + lines.join("\n"),
  };
}

const ClickA11yArgs = z.object({
  ref: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  tab_id: z.string().optional(),
});

export async function handleClickAccessibility(
  args: unknown,
  state: ServerState,
  page: any
) {
  const { ref, role, name } = ClickA11yArgs.parse(args);

  const cached = state.locatorCache.resolveA11y(ref);

  const targetRole = role || cached?.role || null;
  const targetName = name || cached?.name || null;

  if (!targetRole || !targetName) {
    throw new Error(
      `A11y ref "${ref}" not found in cache and no explicit role/name provided. Call browser_get_accessibility_tree first.`
    );
  }

  try {
    await page.locator(`role=${targetRole}[name="${targetName}"]`).first().click({
      timeout: 5000,
    });
    return { status: "success", method: "playwright-a11y-click", ref };
  } catch (e: any) {
    try {
      await page.evaluate(
        ({ r, n }: { r: string; n: string }) => {
          const all = document.querySelectorAll(
            `[role="${r}"], [aria-label="${n}"], [aria-labelledby]`
          );
          for (const el of all) {
            const label =
              el.getAttribute("aria-label") || el.textContent?.trim();
            if (label === n) {
              (el as HTMLElement).click();
              return true;
            }
          }
          const byText = Array.from(
            document.querySelectorAll(
              `a, button, [role="button"], [role="link"]`
            )
          ).find((el) => {
            const text = (el.textContent || "").trim();
            return text === n || text.includes(n);
          });
          if (byText) {
            (byText as HTMLElement).click();
            return true;
          }
          return false;
        },
        { r: targetRole, n: targetName }
      );

      return {
        status: "success",
        method: "js-fallback-a11y-click",
        ref,
      };
    } catch (jsError: any) {
      throw new Error(
        `Failed to click "${targetRole}" named "${targetName}" via both Playwright a11y and JS DOM fallback: ${jsError.message}`
      );
    }
  }
}
