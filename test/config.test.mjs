import assert from "node:assert/strict";
import test from "node:test";

const keys = [
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_HOST",
  "CONFLUENCE_API_BASE_PATH",
  "CONFLUENCE_PAT",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_DEFAULT_PAGE_SIZE",
  "ATLASSIAN_DC_MCP_REQUEST_TIMEOUT_MS",
];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const { loadConfig, normalizeBaseUrl } = await import("../dist/config.js");

test("loads generic host and token configuration", () => {
  try {
    for (const key of keys) delete process.env[key];
    process.env.CONFLUENCE_HOST = "confluence.example.com";
    process.env.CONFLUENCE_API_TOKEN = "test-token";
    process.env.CONFLUENCE_DEFAULT_PAGE_SIZE = "17";
    process.env.ATLASSIAN_DC_MCP_REQUEST_TIMEOUT_MS = "45000";

    const config = loadConfig();
    assert.equal(config.baseUrl, "https://confluence.example.com");
    assert.equal(config.token, "test-token");
    assert.equal(config.defaultPageSize, 17);
    assert.equal(config.requestTimeoutMs, 45000);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("normalizes Confluence REST suffixes and context paths", () => {
  assert.equal(normalizeBaseUrl("confluence.example.com", "/rest"), "https://confluence.example.com");
  assert.equal(normalizeBaseUrl(undefined, "https://confluence.example.com/rest/api"), "https://confluence.example.com");
  assert.equal(normalizeBaseUrl("confluence.example.com", "/wiki/rest/api"), "https://confluence.example.com/wiki");
});
