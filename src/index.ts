#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { loadConfig } from "./config.js";
import { startRemoteServer } from "./remote.js";
import { runSetup } from "./setup.js";
import { packageVersion } from "./version.js";

async function main(): Promise<void> {
  if (process.argv[2] === "setup") {
    await runSetup(process.argv.slice(3));
    return;
  }

  const config = loadConfig();
  if (config.transport !== "stdio") {
    await startRemoteServer(config);
    const endpoint = config.transport === "sse" ? config.ssePath : config.httpPath;
    console.error(`Confluence Data Center MCP ${config.transport} server listening at http://${config.host}:${config.port}${endpoint}`);
    return;
  }

  const server = new McpServer(
    { name: "confluence-data-center", version: packageVersion },
    { capabilities: { tools: {} } },
  );
  registerTools(server);
  await server.connect(new StdioServerTransport());
  console.error(`Confluence Data Center MCP running (${config.baseUrl})`);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
