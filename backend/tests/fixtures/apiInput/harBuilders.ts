/**
 * Pure builders for synthetic HAR documents (specs/056 T043). They create captures in memory so
 * limit and timing tests never need a large committed file. Everything is synthetic: no real host,
 * person or credential.
 */

export interface EntryOptions {
  method?: string;
  url: string;
  status?: number;
  /** ISO timestamp; defaults to a fixed instant plus `index` seconds when built through `harOf`. */
  startedAt?: string;
  requestHeaders?: Record<string, string>;
  /** Explicit query list; when omitted it is read from the URL. */
  query?: [string, string][];
  requestBody?: {
    mimeType: string;
    text?: string;
    params?: { name: string; value?: string; fileName?: string; contentType?: string }[];
  };
  responseMimeType?: string;
  responseText?: string;
  responseEncoding?: string;
  responseSize?: number;
  responseHeaders?: Record<string, string>;
  resourceType?: string;
  webSocket?: boolean;
}

function headerList(headers: Record<string, string> | undefined): { name: string; value: string }[] {
  return Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }));
}

function queryOf(url: string): [string, string][] {
  const question = url.indexOf("?");
  if (question < 0) return [];
  return [...new URLSearchParams(url.slice(question + 1).split("#")[0])];
}

export function harEntry(options: EntryOptions): Record<string, unknown> {
  const text = options.responseText;
  return {
    startedDateTime: options.startedAt ?? "2026-01-01T10:00:00.000Z",
    time: 25,
    ...(options.resourceType ? { _resourceType: options.resourceType } : {}),
    ...(options.webSocket ? { _webSocketMessages: [{ type: "send", time: 1, opcode: 1, data: "x" }] } : {}),
    request: {
      method: options.method ?? "GET",
      url: options.url,
      httpVersion: "HTTP/1.1",
      headers: headerList(options.requestHeaders),
      queryString: (options.query ?? queryOf(options.url)).map(([name, value]) => ({ name, value })),
      cookies: [],
      ...(options.requestBody
        ? {
            postData: {
              mimeType: options.requestBody.mimeType,
              ...(options.requestBody.text !== undefined ? { text: options.requestBody.text } : {}),
              ...(options.requestBody.params ? { params: options.requestBody.params } : {}),
            },
          }
        : {}),
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: options.status ?? 200,
      statusText: "",
      httpVersion: "HTTP/1.1",
      headers: headerList(options.responseHeaders),
      cookies: [],
      content: {
        size: options.responseSize ?? (text !== undefined ? text.length : 0),
        mimeType: options.responseMimeType ?? (text !== undefined ? "application/json" : ""),
        ...(text !== undefined ? { text } : {}),
        ...(options.responseEncoding ? { encoding: options.responseEncoding } : {}),
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 1, wait: 20, receive: 1 },
  };
}

/** A JSON request/response exchange. */
export function jsonEntry(
  method: string,
  url: string,
  status: number,
  response?: unknown,
  request?: unknown,
  extra: Partial<EntryOptions> = {},
): Record<string, unknown> {
  return harEntry({
    method,
    url,
    status,
    ...(request !== undefined ? { requestBody: { mimeType: "application/json", text: JSON.stringify(request) } } : {}),
    ...(response !== undefined ? { responseText: JSON.stringify(response), responseMimeType: "application/json" } : {}),
    ...extra,
  });
}

export function harOf(
  entries: Record<string, unknown>[],
  options: { pages?: string[]; creator?: string } = {},
): Record<string, unknown> {
  const stamped = entries.map((entry, index) => {
    const started = new Date(Date.UTC(2026, 0, 1, 10, 0, 0) + index * 1000).toISOString();
    return entry.startedDateTime === "2026-01-01T10:00:00.000Z" ? { ...entry, startedDateTime: started } : entry;
  });
  return {
    log: {
      version: "1.2",
      creator: { name: options.creator ?? "ApiPilot synthetic builder", version: "1.0" },
      pages: (options.pages ?? ["https://shop.test/"]).map((title, index) => ({
        startedDateTime: "2026-01-01T10:00:00.000Z",
        id: `page_${index + 1}`,
        title,
        pageTimings: {},
      })),
      entries: stamped,
    },
  };
}

/** N distinct, cheap JSON API entries on one origin (for count and timing tests). */
export function manyEntries(count: number, origin = "https://api.shop.test"): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push(jsonEntry("GET", `${origin}/v1/items/${1000 + (i % 40)}?page=${i % 3}`, 200, { id: 1000 + (i % 40), name: `item ${i % 40}` }));
  }
  return entries;
}

/** A JSON document nested `depth` objects deep, as text. */
export function nestedJson(depth: number): string {
  return `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
}
