import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools, startAutoFlush } from "./register-tools";

// MCP servers communicate over stdio with JSON-RPC. Anything written to stdout
// outside the framed protocol will corrupt the stream. Redirect console.log →
// stderr. (This only matters under stdio; the HTTP entry point keeps
// console.log as-is so the user sees server logs in their terminal.)
const _origLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);
void _origLog;

const server = new McpServer({
  name: "apex-engine",
  version: "0.1.0",
});

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] apex-engine MCP server connected on stdio");

startAutoFlush({ logTag: "mcp" });
