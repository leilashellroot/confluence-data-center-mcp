import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ConfluenceMCPConfig } from "./config.js";
import { registerTools } from "./tools.js";
import { packageVersion } from "./version.js";

interface Session<TTransport> {
  server: McpServer;
  transport: TTransport;
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "confluence-data-center", version: packageVersion },
    { capabilities: { tools: {} } },
  );
  registerTools(server);
  return server;
}

function setCorsHeaders(res: ServerResponse, config: ConfluenceMCPConfig): void {
  if (!config.corsOrigin) return;
  res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
}

function transportOptions(config: ConfluenceMCPConfig) {
  return {
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    enableDnsRebindingProtection: config.allowedHosts.length > 0 || config.allowedOrigins.length > 0,
  };
}

async function handleStreamableRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ConfluenceMCPConfig,
  sessions: Map<string, Session<StreamableHTTPServerTransport>>,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"];
  const existingSession = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
  if (existingSession) {
    await existingSession.transport.handleRequest(req, res);
    return;
  }
  if (sessionId) {
    sendJson(res, 404, { error: "MCP session not found" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 400, { error: "MCP session is required" });
    return;
  }

  const server = createMcpServer();
  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    ...transportOptions(config),
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, { server, transport });
    },
    onsessionclosed: (closedSessionId) => {
      sessions.delete(closedSessionId);
    },
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    if (transport.sessionId) sessions.delete(transport.sessionId);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

async function handleSseRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ConfluenceMCPConfig,
  sessions: Map<string, Session<SSEServerTransport>>,
): Promise<void> {
  const url = requestUrl(req);
  if (req.method === "GET" && url.pathname === config.ssePath) {
    const server = createMcpServer();
    const transport = new SSEServerTransport(config.messagesPath, res, transportOptions(config));
    sessions.set(transport.sessionId, { server, transport });
    transport.onclose = () => sessions.delete(transport.sessionId);
    try {
      await server.connect(transport);
    } catch (error) {
      sessions.delete(transport.sessionId);
      throw error;
    }
    return;
  }
  if (req.method === "POST" && url.pathname === config.messagesPath) {
    const sessionId = url.searchParams.get("sessionId");
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sendJson(res, 404, { error: "SSE session not found" });
      return;
    }
    await session.transport.handlePostMessage(req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
}

export async function startRemoteServer(config: ConfluenceMCPConfig): Promise<HttpServer> {
  const streamableSessions = new Map<string, Session<StreamableHTTPServerTransport>>();
  const sseSessions = new Map<string, Session<SSEServerTransport>>();
  const httpServer = createServer(async (req, res) => {
    setCorsHeaders(res, config);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (config.transport === "streamable-http") {
        if (requestUrl(req).pathname !== config.httpPath) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        await handleStreamableRequest(req, res, config, streamableSessions);
      } else {
        await handleSseRequest(req, res, config, sseSessions);
      }
    } catch (error) {
      console.error("Remote MCP request failed:", error);
      sendJson(res, 500, { error: "Internal server error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });
  return httpServer;
}
