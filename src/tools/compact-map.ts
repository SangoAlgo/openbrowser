import { z } from "zod";
import { ServerState } from "../server.js";

interface CompactElement {
  ref: string;
  tag: string;
  text: string;
  role: string;
  name: string;
  tsid: string;
  ariaLabel: string;
  href: string;
  visible: boolean;
}

export function registerCompactMapTools() {
  return [
    {
      name: "browser_get_compact_map",
      description:
        "Compact element map with persistent ref IDs [e1], [e2]... (60 max, paginated). Ref IDs are stable within a tab session — cached by data-tsid > aria-label > role+name. Accept optional scope selector to filter region.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tab_id: { type: "string" },
          max_elements: { type: "number", default: 60 },
          offset: { type: "number", default: 0 },
          scope: { type: "string", description: "CSS selector to scope the map (e.g. '#chat-panel', '[role=\"navigation\"]')" },
        },
      },
    },
  ];
}

const CompactMapArgs = z.object({
  tab_id: z.string().optional(),
  max_elements: z.number().default(60),
  offset: z.number().default(0),
  scope: z.string().optional(),
});

export async function handleCompactMap(args: unknown, state: ServerState, page: any) {
  const { max_elements, offset, scope } = CompactMapArgs.parse(args);

  const elements: CompactElement[] = await page.evaluate(
    ({ max, off, sc }: { max: number; off: number; sc?: string }) => {
      const root = sc ? document.querySelector(sc) : document;
      if (!root) return [];

      const all = Array.from(
        root.querySelectorAll(
          'button, a, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"], h1, h2, h3, h4, h5, h6'
        )
      );

      const visible = all.filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      return visible.slice(off, off + max).map((el, i) => ({
        ref: `e${off + i + 1}`,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().substring(0, 60),
        role: el.getAttribute("role") || guessRole(el),
        name: el.getAttribute("aria-label") || el.getAttribute("name") || "",
        tsid: el.getAttribute("data-tsid") || el.getAttribute("tsid") || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        href: (el as HTMLAnchorElement).href?.substring(0, 120) || "",
        visible: true,
      }));
    },
    { max: max_elements, off: offset, sc: scope }
  );

  for (const el of elements) {
    state.locatorCache.set(el.ref, buildStableSelector(el));
  }

  const lines = elements.map((el) => {
    const label = el.tag === "input" || el.tag === "textarea"
      ? `"${el.name}"`
      : `"${el.text}"`;
    const ce = el.tag === "div" && el.role === "textbox" ? " (ce)" : "";
    return `[${el.ref}] ${el.tag}${ce} ${label}`;
  });

  const total = elements.length;
  const hasMore = total === max_elements;

  return {
    status: "success",
    element_count: total,
    total_available: total,
    compact_element_map: lines.join("\n"),
    has_more: hasMore,
    next_offset: hasMore ? offset + max_elements : undefined,
  };
}

function guessRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return "checkbox";
    if (type === "submit" || type === "button") return "button";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (el.isContentEditable) return "textbox";
  if (/^h[1-6]$/.test(tag)) return "heading";
  return "generic";
}

function buildStableSelector(el: CompactElement): string {
  if (el.tsid) return `[data-tsid="${el.tsid}"]`;
  if (el.ariaLabel) return `[aria-label="${el.ariaLabel}"]`;
  if (el.name && el.role === "textbox") return `[name="${el.name}"]`;
  if (el.role && el.name) return `[role="${el.role}"][name="${el.name}"]`;
  if (el.href) return `[href="${el.href}"]`;
  if (el.text) return `text="${el.text}"`;
  return el.tag;
}
