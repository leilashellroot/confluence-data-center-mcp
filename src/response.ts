export type BodyMode = "storage" | "text" | "none";

const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&(nbsp|amp|lt|gt|quot);|&#39;/g, (match) => ENTITY_MAP[match] ?? match)
    .replace(/&#(\d+);/g, (_, code: string) => {
      const parsed = Number.parseInt(code, 10);
      return Number.isNaN(parsed) ? "" : String.fromCodePoint(parsed);
    });
}

export function storageToText(storageValue: string): string {
  const withLineBreaks = storageValue
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|td|th|blockquote|pre|ul|ol|table|section|article)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withLineBreaks)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function shapeBody(body: unknown, mode: BodyMode): unknown {
  if (!body || typeof body !== "object" || mode === "storage") return body;
  const bodyObject = body as Record<string, unknown>;
  if (mode === "none") return undefined;
  const storage = bodyObject.storage as Record<string, unknown> | undefined;
  const value = typeof storage?.value === "string" ? storage.value : undefined;
  if (value === undefined) return body;
  return {
    ...bodyObject,
    text: { value: storageToText(value), representation: "text" },
  };
}

export function shapeContent<T extends Record<string, unknown>>(content: T, mode: BodyMode = "storage"): T {
  if (mode === "storage") return content;
  const shaped = { ...content } as Record<string, unknown>;
  const body = shapeBody(shaped.body, mode);
  if (body === undefined) delete shaped.body;
  else shaped.body = body;
  return shaped as T;
}

export function shapeFullContent<T extends Record<string, unknown>>(content: T): T {
  const shaped = { ...content } as Record<string, unknown>;
  const body = shaped.body as Record<string, unknown> | undefined;
  const storage = body?.storage as Record<string, unknown> | undefined;
  if (typeof storage?.value === "string") {
    shaped.body = {
      ...body,
      text: { value: storageToText(storage.value), representation: "text" },
    };
  }
  return shaped as T;
}

export function mutationAck(content: Record<string, unknown>): Record<string, unknown> {
  const links = content._links as Record<string, unknown> | undefined;
  const base = typeof links?.base === "string" ? links.base : "";
  const webui = typeof links?.webui === "string" ? links.webui : undefined;
  const version = content.version as Record<string, unknown> | undefined;
  const space = content.space as Record<string, unknown> | undefined;
  return {
    ...(content.id !== undefined ? { id: content.id } : {}),
    ...(content.type !== undefined ? { type: content.type } : {}),
    ...(content.title !== undefined ? { title: content.title } : {}),
    ...(typeof space?.key === "string" ? { spaceKey: space.key } : {}),
    ...(version?.number !== undefined ? { version: version.number } : {}),
    ...(webui ? { url: `${base}${webui}` } : {}),
  };
}

export function toolText(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function toolError(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: false,
        error: message,
        ...(response?.status ? { status: response.status } : {}),
        ...(response?.data !== undefined ? { details: response.data } : {}),
      }, null, 2),
    }],
    isError: true,
  };
}
