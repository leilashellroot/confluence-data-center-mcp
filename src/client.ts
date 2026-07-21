import axios, { type AxiosInstance, type AxiosRequestConfig, type Method } from "axios";
import FormData from "form-data";
import { createReadStream } from "node:fs";
import { loadConfig, type ConfluenceMCPConfig } from "./config.js";

export type JsonObject = Record<string, unknown>;

export interface ListResponse<T = JsonObject> extends JsonObject {
  results?: T[];
  totalCount?: number;
  start?: number;
  limit?: number;
  size?: number;
  _links?: {
    base?: string;
    context?: string;
    self?: string;
    next?: string;
    prev?: string;
  };
}

export interface PageParams {
  limit?: number;
  start?: number;
  expand?: string;
  [key: string]: unknown;
}

export interface PaginateOptions {
  limit?: number;
  start?: number;
  maxPages?: number;
}

function nextStart<T extends JsonObject>(page: ListResponse<T>, currentStart: number, pageSize: number): number | undefined {
  const nextLink = page._links?.next;
  if (nextLink) {
    try {
      const value = new URL(nextLink, "http://localhost").searchParams.get("start");
      if (value !== null && Number.isInteger(Number(value))) return Number(value);
    } catch {
      // Fall back to the response counters when the server returns a relative or malformed link.
    }
  }

  const results = page.results?.length ?? 0;
  if (results === 0) return undefined;
  const nextOffset = currentStart + results;
  if (page.totalCount !== undefined && nextOffset >= page.totalCount) return undefined;
  if (results < (page.limit ?? pageSize)) return undefined;
  return nextOffset;
}

export async function paginate<T extends JsonObject>(
  fetchPage: (start: number, limit: number) => Promise<ListResponse<T>>,
  options: PaginateOptions = {},
): Promise<T[]> {
  const limit = options.limit ?? 100;
  let start = options.start ?? 0;
  const results: T[] = [];
  const maxPages = options.maxPages ?? 10_000;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await fetchPage(start, limit);
    results.push(...(page.results ?? []));
    const next = nextStart(page, start, limit);
    if (next === undefined || next <= start) return results;
    start = next;
  }

  throw new Error(`Pagination exceeded the safety limit of ${maxPages} pages`);
}

export class ConfluenceClient {
  private readonly client: AxiosInstance;

  constructor(config: ConfluenceMCPConfig) {
    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api`,
      timeout: config.requestTimeoutMs,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      paramsSerializer: { indexes: null },
    });
  }

  async request<T = unknown>(method: Method, path: string, requestConfig: AxiosRequestConfig = {}): Promise<T> {
    const response = await this.client.request<T>({ method, url: path, ...requestConfig });
    return response.data;
  }

  getContent(contentId: string, params?: PageParams): Promise<JsonObject> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}`, { params });
  }

  listContent(params?: PageParams): Promise<ListResponse> {
    return this.request("GET", "/content", { params });
  }

  searchContent(params: PageParams & { cql: string; cqlcontext?: string; excerpt?: string }): Promise<ListResponse> {
    return this.request("GET", "/content/search", { params });
  }

  scanContent(params?: PageParams & { cursor?: string; type?: string; status?: string; spaceKey?: string }): Promise<ListResponse & { nextCursor?: string; prevCursor?: string }> {
    return this.request("GET", "/content/scan", { params });
  }

  createContent(body: JsonObject, params?: PageParams): Promise<JsonObject> {
    return this.request("POST", "/content", { params, data: body });
  }

  updateContent(contentId: string, body: JsonObject, params?: PageParams): Promise<JsonObject> {
    return this.request("PUT", `/content/${encodeURIComponent(contentId)}`, { params, data: body });
  }

  deleteContent(contentId: string, params?: PageParams): Promise<unknown> {
    return this.request("DELETE", `/content/${encodeURIComponent(contentId)}`, { params });
  }

  getChildren(contentId: string, type?: string, params?: PageParams): Promise<ListResponse> {
    const suffix = type ? `/child/${encodeURIComponent(type)}` : "/child";
    return this.request("GET", `/content/${encodeURIComponent(contentId)}${suffix}`, { params });
  }

  getComments(contentId: string, params?: PageParams & { depth?: string; location?: string[]; parentVersion?: number }): Promise<ListResponse> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/child/comment`, { params });
  }

  getDescendants(contentId: string, type?: string, params?: PageParams): Promise<ListResponse> {
    const suffix = type ? `/descendant/${encodeURIComponent(type)}` : "/descendant";
    return this.request("GET", `/content/${encodeURIComponent(contentId)}${suffix}`, { params });
  }

  getHistory(contentId: string, params?: PageParams): Promise<JsonObject> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/history`, { params });
  }

  deleteContentVersion(contentId: string, version: number): Promise<unknown> {
    return this.request("DELETE", `/content/${encodeURIComponent(contentId)}/version/${version}`);
  }

  getSpaces(params?: PageParams): Promise<ListResponse> {
    return this.request("GET", "/space", { params });
  }

  getSpace(spaceKey: string, params?: PageParams): Promise<JsonObject> {
    return this.request("GET", `/space/${encodeURIComponent(spaceKey)}`, { params });
  }

  createSpace(body: JsonObject): Promise<JsonObject> {
    return this.request("POST", "/space", { data: body });
  }

  updateSpace(spaceKey: string, body: JsonObject): Promise<JsonObject> {
    return this.request("PUT", `/space/${encodeURIComponent(spaceKey)}`, { data: body });
  }

  deleteSpace(spaceKey: string): Promise<unknown> {
    return this.request("DELETE", `/space/${encodeURIComponent(spaceKey)}`);
  }

  archiveSpace(spaceKey: string): Promise<unknown> {
    return this.request("PUT", `/space/${encodeURIComponent(spaceKey)}/archive`);
  }

  getSpaceContent(spaceKey: string, type?: string, params?: PageParams): Promise<ListResponse> {
    const suffix = type ? `/content/${encodeURIComponent(type)}` : "/content";
    return this.request("GET", `/space/${encodeURIComponent(spaceKey)}${suffix}`, { params });
  }

  getAttachments(contentId: string, params?: PageParams): Promise<ListResponse> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/child/attachment`, { params });
  }

  getAttachment(contentId: string, attachmentId: string, params?: PageParams): Promise<JsonObject> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/child/attachment/${encodeURIComponent(attachmentId)}`, { params });
  }

  async addAttachment(contentId: string, filePath: string, options: { comment?: string; minorEdit?: boolean; allowDuplicated?: boolean } = {}): Promise<unknown> {
    const form = new FormData();
    form.append("file", createReadStream(filePath));
    if (options.comment !== undefined) form.append("comment", options.comment);
    if (options.minorEdit !== undefined) form.append("minorEdit", String(options.minorEdit));
    return this.request("POST", `/content/${encodeURIComponent(contentId)}/child/attachment`, {
      params: { allowDuplicated: options.allowDuplicated },
      data: form,
      headers: { ...form.getHeaders(), "X-Atlassian-Token": "nocheck" },
    });
  }

  updateAttachment(contentId: string, attachmentId: string, body: JsonObject): Promise<JsonObject> {
    return this.request("PUT", `/content/${encodeURIComponent(contentId)}/child/attachment/${encodeURIComponent(attachmentId)}`, { data: body });
  }

  async updateAttachmentData(contentId: string, attachmentId: string, filePath: string, options: { comment?: string; minorEdit?: boolean } = {}): Promise<unknown> {
    const form = new FormData();
    form.append("file", createReadStream(filePath));
    if (options.comment !== undefined) form.append("comment", options.comment);
    if (options.minorEdit !== undefined) form.append("minorEdit", String(options.minorEdit));
    return this.request("POST", `/content/${encodeURIComponent(contentId)}/child/attachment/${encodeURIComponent(attachmentId)}/data`, {
      data: form,
      headers: { ...form.getHeaders(), "X-Atlassian-Token": "nocheck" },
    });
  }

  deleteAttachment(contentId: string, attachmentId: string): Promise<unknown> {
    return this.request("DELETE", `/content/${encodeURIComponent(contentId)}/child/attachment/${encodeURIComponent(attachmentId)}`);
  }

  getLabels(contentId: string, params?: PageParams): Promise<ListResponse> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/label`, { params });
  }

  addLabels(contentId: string, body: unknown): Promise<ListResponse> {
    return this.request("POST", `/content/${encodeURIComponent(contentId)}/label`, { data: body });
  }

  removeLabel(contentId: string, label: string): Promise<unknown> {
    return this.request("DELETE", `/content/${encodeURIComponent(contentId)}/label`, { params: { name: label } });
  }

  getContentProperties(contentId: string, params?: PageParams): Promise<ListResponse> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/property`, { params });
  }

  getContentProperty(contentId: string, key: string, params?: PageParams): Promise<JsonObject> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/property/${encodeURIComponent(key)}`, { params });
  }

  createContentProperty(contentId: string, body: JsonObject): Promise<JsonObject> {
    return this.request("POST", `/content/${encodeURIComponent(contentId)}/property`, { data: body });
  }

  updateContentProperty(contentId: string, key: string, body: JsonObject, params?: PageParams): Promise<JsonObject> {
    return this.request("PUT", `/content/${encodeURIComponent(contentId)}/property/${encodeURIComponent(key)}`, { params, data: body });
  }

  deleteContentProperty(contentId: string, key: string): Promise<unknown> {
    return this.request("DELETE", `/content/${encodeURIComponent(contentId)}/property/${encodeURIComponent(key)}`);
  }

  getRestrictions(contentId: string, operation?: string, params?: PageParams): Promise<JsonObject> {
    const suffix = operation ? `/restriction/byOperation/${encodeURIComponent(operation)}` : "/restriction/byOperation";
    return this.request("GET", `/content/${encodeURIComponent(contentId)}${suffix}`, { params });
  }

  updateRestrictions(contentId: string, body: unknown, params?: PageParams): Promise<unknown> {
    return this.request("PUT", `/content/${encodeURIComponent(contentId)}/restriction`, { params, data: body });
  }

  getWatchers(contentId: string, params?: PageParams): Promise<ListResponse> {
    return this.request("GET", `/content/${encodeURIComponent(contentId)}/watchers`, { params });
  }

  getCurrentUser(params?: PageParams): Promise<JsonObject> {
    return this.request("GET", "/user/current", { params });
  }

  getUser(params: PageParams): Promise<JsonObject> {
    return this.request("GET", "/user", { params });
  }

  getUsers(params?: PageParams): Promise<ListResponse> {
    return this.request("GET", "/user/list", { params });
  }
}

let context: { config: ConfluenceMCPConfig; client: ConfluenceClient } | undefined;

export function getContext(): { config: ConfluenceMCPConfig; client: ConfluenceClient } {
  if (!context) {
    const config = loadConfig();
    context = { config, client: new ConfluenceClient(config) };
  }
  return context;
}

export function setContext(value: { config: ConfluenceMCPConfig; client: ConfluenceClient } | undefined): void {
  context = value;
}
