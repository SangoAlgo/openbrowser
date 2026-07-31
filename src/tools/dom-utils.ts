import { z } from "zod";

export function registerDOMTools() {
  return [
    {
      name: "browser_get_content",
      description: "Get page content in text, HTML, or innerText format. Optional CSS selector to scope.",
      inputSchema: {
        type: "object" as const,
        properties: {
          format: { type: "string", enum: ["text", "html", "inner_text"], default: "text" },
          selector: { type: "string" },
          tab_id: { type: "string" },
        },
      },
    },
    {
      name: "browser_evaluate_js",
      description: "Execute JavaScript in page context. Returns JSON-serialized result.",
      inputSchema: {
        type: "object" as const,
        properties: {
          script: { type: "string" },
          tab_id: { type: "string" },
        },
        required: ["script"],
      },
    },
    {
      name: "browser_take_screenshot",
      description: "Take full-page or element screenshot.",
      inputSchema: {
        type: "object" as const,
        properties: {
          full_page: { type: "boolean", default: false },
          selector: { type: "string" },
          path: { type: "string" },
          return_base64: { type: "boolean", default: false },
          tab_id: { type: "string" },
        },
      },
    },
  ];
}

const GetContentArgs = z.object({
  format: z.enum(["text", "html", "inner_text"]).default("text"),
  selector: z.string().optional(),
});

export async function handleGetContent(args: unknown, page: any) {
  const { format, selector } = GetContentArgs.parse(args);

  let content: string;
  if (selector) {
    const el = await page.locator(selector).first();
    if (format === "html") content = await el.innerHTML();
    else if (format === "inner_text") content = await el.innerText();
    else content = await el.textContent();
  } else {
    if (format === "html") content = await page.content();
    else if (format === "inner_text") content = await page.evaluate(() => document.body?.innerText || "");
    else content = await page.evaluate(() => document.body?.textContent || "");
  }

  return {
    status: "success",
    url: page.url(),
    title: await page.title(),
    selector: selector || null,
    format,
    length: content.length,
    content,
  };
}

export async function handleEvaluateJS(args: unknown, page: any) {
  const { script } = z.object({ script: z.string() }).parse(args);
  const result = await page.evaluate(script);
  return { status: "success", url: page.url(), result: JSON.stringify(result) };
}

import fs from "fs";
import path from "path";

const ScreenshotArgs = z.object({
  full_page: z.boolean().default(false),
  selector: z.string().optional(),
  path: z.string().optional(),
  return_base64: z.boolean().default(false),
});

export async function handleScreenshot(args: unknown, page: any) {
  const { full_page, selector, path: savePath, return_base64 } = ScreenshotArgs.parse(args);

  const options: any = { fullPage: full_page, type: "png" };
  if (savePath) options.path = savePath;

  let buffer: Buffer;
  if (selector) {
    const el = page.locator(selector).first();
    buffer = await el.screenshot(options);
  } else {
    buffer = await page.screenshot(options);
  }

  const resultPath = savePath || path.join(process.cwd(), "screenshots", `screenshot_${Date.now()}.png`);
  if (!savePath) {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, buffer);
  }

  return {
    status: "success",
    url: page.url(),
    size_bytes: buffer.length,
    file_path: resultPath,
    ...(return_base64 ? { base64: buffer.toString("base64") } : {}),
  };
}
