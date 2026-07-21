import assert from "node:assert/strict";
import test from "node:test";

process.env.CONFLUENCE_BASE_URL = "http://confluence.invalid";
process.env.CONFLUENCE_API_TOKEN = "test-token";

const { startRemoteServer } = await import("../dist/remote.js");
const { setContext } = await import("../dist/client.js");

function config(transport) {
  return {
    baseUrl: process.env.CONFLUENCE_BASE_URL,
    token: process.env.CONFLUENCE_API_TOKEN,
    defaultPageSize: 25,
    requestTimeoutMs: 30000,
    transport,
    host: "127.0.0.1",
    port: 0,
    httpPath: "/mcp",
    ssePath: "/sse",
    messagesPath: "/messages",
    allowedHosts: [],
    allowedOrigins: [],
  };
}

function serverUrl(server) {
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

const streamableHeaders = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

test("Streamable HTTP initializes and exposes Confluence tools", async () => {
  setContext(undefined);
  const server = await startRemoteServer(config("streamable-http"));
  const baseUrl = serverUrl(server);
  try {
    const initializeResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: streamableHeaders,
      body: JSON.stringify(initializeRequest()),
    });
    assert.equal(initializeResponse.status, 200);
    assert.match(await initializeResponse.text(), /"serverInfo":\{"name":"confluence-data-center"/);
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    const toolsResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...streamableHeaders, "MCP-Session-Id": sessionId, "MCP-Protocol-Version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(toolsResponse.status, 200);
    assert.match(await toolsResponse.text(), /confluence_get_content/);
  } finally {
    await closeServer(server);
  }
});
