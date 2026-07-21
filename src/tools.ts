import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getContentContext } from "./context.js";
import { getContext, paginate, type JsonObject } from "./client.js";
import { BodyMode, mutationAck, shapeContent, toolError, toolText } from "./response.js";

const paging = {
  limit: z.number().int().positive().optional().describe("Maximum results to return"),
  start: z.number().int().nonnegative().optional().describe("Index of the first result to return"),
  expand: z.string().optional().describe("Comma-separated properties to expand"),
};

const contentId = z.string().min(1).describe("Confluence content ID");
const spaceKey = z.string().min(1).describe("Confluence space key");
const output = z.enum(["ack", "full"]).optional().describe("Return a compact acknowledgement or the full response");

type ToolResult = ReturnType<typeof toolText> | ReturnType<typeof toolError>;

async function invoke(action: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return toolText(await action());
  } catch (error) {
    return toolError(error);
  }
}

function resultForMutation(result: unknown, mode?: "ack" | "full"): unknown {
  if (mode === "full" || !result || typeof result !== "object") return result;
  return mutationAck(result as JsonObject);
}

function escapeCqlPhrase(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function registerTools(server: McpServer): void {
  const { client, config } = getContext();

  const getContentSchema = {
    contentId,
    expand: paging.expand,
    bodyMode: z.enum(["storage", "text", "none"]).optional(),
  };
  const getContentHandler = ({ contentId: id, expand, bodyMode }: { contentId: string; expand?: string; bodyMode?: BodyMode }) =>
    invoke(async () => shapeContent(await client.getContent(id, { expand: expand ?? "body.storage" }), bodyMode ?? "storage"));

  server.tool("confluence_get_content", "Get Confluence Data Center content by ID", getContentSchema, getContentHandler);
  server.tool("confluence_getContent", "Compatibility alias for confluence_get_content", getContentSchema, getContentHandler);

  server.tool(
    "confluence_get_content_context",
    "Get the complete Confluence document body and every footer, inline, resolved, and nested comment thread in one call",
    { contentId },
    ({ contentId: id }) => invoke(() => getContentContext(id, config.defaultPageSize)),
  );

  const searchSchema = {
    cql: z.string().min(1).describe("Confluence Query Language query"),
    ...paging,
    cqlcontext: z.string().optional().describe("Serialized Confluence CQL context JSON"),
    excerpt: z.enum(["none", "highlight"]).optional().describe("Excerpt mode"),
  };
  const searchHandler = ({ cql, limit, start, expand, cqlcontext, excerpt }: { cql: string; limit?: number; start?: number; expand?: string; cqlcontext?: string; excerpt?: string }) =>
    invoke(() => client.searchContent({ cql, limit: limit ?? config.defaultPageSize, start, expand, cqlcontext, excerpt }));
  server.tool("confluence_search_content", "Search Confluence Data Center content using CQL", searchSchema, searchHandler);
  server.tool("confluence_searchContent", "Compatibility alias for confluence_search_content", searchSchema, searchHandler);

  server.tool(
    "confluence_scan_content",
    "Scan Confluence content using cursor pagination",
    { ...paging, cursor: z.string().optional(), type: z.string().optional(), status: z.string().optional(), spaceKey: z.string().optional() },
    ({ limit, cursor, expand, type, status, spaceKey: key }) => invoke(() => client.scanContent({ limit: limit ?? config.defaultPageSize, cursor, expand, type, status, spaceKey: key })),
  );

  const createSchema = {
    title: z.string().describe("Content title"),
    spaceKey,
    type: z.string().default("page").describe("Content type, usually page or blogpost"),
    content: z.string().describe("Complete body in Confluence storage format"),
    parentId: z.string().optional().describe("Parent page ID"),
    output,
  };
  const createHandler = ({ title, spaceKey: key, type, content, parentId, output: mode }: { title: string; spaceKey: string; type: string; content: string; parentId?: string; output?: "ack" | "full" }) =>
    invoke(async () => {
      const body: JsonObject = {
        type,
        title,
        space: { key },
        body: { storage: { value: content, representation: "storage" } },
      };
      if (parentId) body.ancestors = [{ id: parentId }];
      return resultForMutation(await client.createContent(body), mode);
    });
  server.tool("confluence_create_content", "Create Confluence content", createSchema, createHandler);
  server.tool("confluence_createContent", "Compatibility alias for confluence_create_content", createSchema, createHandler);

  const updateSchema = {
    contentId,
    title: z.string().optional(),
    content: z.string().optional().describe("Complete replacement body in storage format"),
    version: z.number().int().positive().describe("New Confluence version number"),
    versionComment: z.string().optional(),
    parentId: z.string().optional(),
    output,
  };
  const updateHandler = ({ contentId: id, title, content, version, versionComment, parentId, output: mode }: { contentId: string; title?: string; content?: string; version: number; versionComment?: string; parentId?: string; output?: "ack" | "full" }) =>
    invoke(async () => {
      const current = await client.getContent(id, { expand: "space,version" });
      const currentSpace = (current.space as JsonObject | undefined) ?? {};
      const body: JsonObject = {
        id,
        type: current.type ?? "page",
        title: title ?? current.title ?? "",
        space: currentSpace,
        version: { number: version, ...(versionComment ? { message: versionComment } : {}) },
      };
      if (content !== undefined) body.body = { storage: { value: content, representation: "storage" } };
      if (parentId) body.ancestors = [{ id: parentId }];
      return resultForMutation(await client.updateContent(id, body), mode);
    });
  server.tool("confluence_update_content", "Update Confluence content with an explicit version", updateSchema, updateHandler);
  server.tool("confluence_updateContent", "Compatibility alias for confluence_update_content", updateSchema, updateHandler);

  server.tool("confluence_delete_content", "Trash or permanently delete Confluence content", { contentId, status: z.string().optional().describe("Use trashed to purge trash content") }, ({ contentId: id, status }) => invoke(() => client.deleteContent(id, { status })));

  server.tool(
    "confluence_get_children",
    "Get direct children of Confluence content",
    { contentId, type: z.string().optional().describe("Filter by child type, such as page, comment, or attachment"), ...paging, parentVersion: z.number().int().positive().optional() },
    ({ contentId: id, type, limit, start, expand, parentVersion }) => invoke(() => client.getChildren(id, type, { limit: limit ?? config.defaultPageSize, start, expand, parentVersion })),
  );

  server.tool(
    "confluence_get_descendants",
    "Get descendants of Confluence content; Confluence commonly supports comment descendants",
    { contentId, type: z.string().optional(), ...paging },
    ({ contentId: id, type, limit, start, expand }) => invoke(() => client.getDescendants(id, type, { limit, start, expand })),
  );

  server.tool("confluence_get_history", "Get content history and version metadata", { contentId, expand: paging.expand }, ({ contentId: id, expand }) => invoke(() => client.getHistory(id, { expand })));
  server.tool("confluence_get_content_version", "Get a specific historical content version", { contentId, version: z.number().int().positive(), expand: paging.expand }, ({ contentId: id, version, expand }) => invoke(() => client.getContent(id, { version, expand: expand ?? "body.storage,version" })));
  server.tool("confluence_delete_content_version", "Delete a historical page or blog post version", { contentId, version: z.number().int().positive() }, ({ contentId: id, version }) => invoke(() => client.deleteContentVersion(id, version)));

  const commentsSchema = { contentId, ...paging, depth: z.enum(["", "all"]).optional(), location: z.array(z.enum(["inline", "footer", "resolved"])).optional(), parentVersion: z.number().int().positive().optional() };
  const commentsHandler = ({ contentId: id, limit, start, expand, depth, location, parentVersion }: { contentId: string; limit?: number; start?: number; expand?: string; depth?: string; location?: string[]; parentVersion?: number }) =>
    invoke(() => client.getComments(id, { limit: limit ?? config.defaultPageSize, start, expand: expand ?? "body.storage,extensions.inlineProperties,extensions.resolution", depth, location, parentVersion }));
  server.tool("confluence_get_comments", "Get document comments with optional inline, footer, resolved, and nested-thread filters", commentsSchema, commentsHandler);

  const createCommentSchema = {
    contentId,
    content: z.string().describe("Comment body in storage format"),
    parentId: z.string().optional().describe("Parent comment ID for a reply"),
    inlineProperties: z.record(z.unknown()).optional().describe("Confluence-build-specific inline comment properties"),
    output,
  };
  server.tool(
    "confluence_create_comment",
    "Create a footer comment or reply using Confluence content semantics; pass inlineProperties for an inline comment on builds that support it",
    createCommentSchema,
    ({ contentId: id, content, parentId, inlineProperties, output: mode }) => invoke(async () => {
      const body: JsonObject = {
        type: "comment",
        container: { id: parentId ?? id },
        body: { storage: { value: content, representation: "storage" } },
      };
      if (inlineProperties) body.extensions = { inlineProperties };
      return resultForMutation(await client.createContent(body), mode);
    }),
  );

  server.tool(
    "confluence_update_comment",
    "Update a comment using Confluence content versioning",
    { contentId, content: z.string().describe("Replacement comment body in storage format"), version: z.number().int().positive(), versionComment: z.string().optional(), output },
    ({ contentId: id, content, version, versionComment, output: mode }) => invoke(async () => {
      const current = await client.getContent(id, { expand: "container,version" });
      const body: JsonObject = {
        id,
        type: "comment",
        container: current.container ?? { id: id },
        version: { number: version, ...(versionComment ? { message: versionComment } : {}) },
        body: { storage: { value: content, representation: "storage" } },
      };
      return resultForMutation(await client.updateContent(id, body), mode);
    }),
  );
  server.tool("confluence_delete_comment", "Delete a comment by content ID", { contentId }, ({ contentId: id }) => invoke(() => client.deleteContent(id)));

  const spacesSchema = { ...paging, spaceKey: z.array(z.string()).optional(), type: z.string().optional(), status: z.string().optional(), label: z.string().optional(), favourite: z.boolean().optional() };
  server.tool("confluence_get_spaces", "List Confluence spaces", spacesSchema, ({ limit, start, expand, ...filters }) => invoke(() => client.getSpaces({ limit: limit ?? config.defaultPageSize, start, expand, ...filters })));
  const searchSpaceSchema = { searchText: z.string().describe("Text to search for in space names"), ...paging, excerpt: z.enum(["none", "highlight"]).optional() };
  const searchSpaceHandler = ({ searchText, limit, start, expand, excerpt }: { searchText: string; limit?: number; start?: number; expand?: string; excerpt?: string }) =>
    invoke(() => client.searchContent({ cql: `type=space AND title ~ "${escapeCqlPhrase(searchText)}"`, limit: limit ?? config.defaultPageSize, start, expand, excerpt }));
  server.tool("confluence_search_spaces", "Search Confluence spaces by title", searchSpaceSchema, searchSpaceHandler);
  server.tool("confluence_searchSpace", "Compatibility alias for confluence_search_spaces", searchSpaceSchema, searchSpaceHandler);
  server.tool("confluence_get_space", "Get a Confluence space", { spaceKey, expand: paging.expand }, ({ spaceKey: key, expand }) => invoke(() => client.getSpace(key, { expand })));
  server.tool("confluence_get_space_content", "List content in a Confluence space", { spaceKey, type: z.string().optional(), depth: z.enum(["all", "root"]).optional(), ...paging }, ({ spaceKey: key, type, depth, limit, start, expand }) => invoke(() => client.getSpaceContent(key, type, { depth, limit: limit ?? config.defaultPageSize, start, expand })));

  const spaceMutationSchema = { spaceKey, name: z.string().optional(), description: z.record(z.unknown()).optional(), type: z.string().optional(), output };
  server.tool("confluence_create_space", "Create a Confluence space", { key: z.string(), name: z.string(), description: z.record(z.unknown()).optional(), type: z.string().optional(), output }, ({ key, name, description, type, output: mode }) => invoke(async () => resultForMutation(await client.createSpace({ key, name, ...(description ? { description } : {}), ...(type ? { type } : {}) }), mode)));
  server.tool("confluence_update_space", "Update a Confluence space", spaceMutationSchema, ({ spaceKey: key, name, description, type, output: mode }) => invoke(async () => resultForMutation(await client.updateSpace(key, { key, ...(name ? { name } : {}), ...(description ? { description } : {}), ...(type ? { type } : {}) }), mode)));
  server.tool("confluence_delete_space", "Delete a Confluence space", { spaceKey }, ({ spaceKey: key }) => invoke(() => client.deleteSpace(key)));
  server.tool("confluence_archive_space", "Archive a Confluence space", { spaceKey }, ({ spaceKey: key }) => invoke(() => client.archiveSpace(key)));

  server.tool("confluence_get_attachments", "List attachments on Confluence content", { contentId, filename: z.string().optional(), mediaType: z.string().optional(), ...paging }, ({ contentId: id, filename, mediaType, limit, start, expand }) => invoke(() => client.getAttachments(id, { filename, mediaType, limit: limit ?? config.defaultPageSize, start, expand })));
  server.tool("confluence_get_attachment", "Get Confluence attachment metadata", { contentId, attachmentId: z.string() }, ({ contentId: id, attachmentId }) => invoke(() => client.getAttachment(id, attachmentId, { expand: "version,container" })));
  server.tool("confluence_add_attachment", "Upload a file attachment to Confluence content", { contentId, filePath: z.string().describe("Absolute local file path"), comment: z.string().optional(), minorEdit: z.boolean().optional(), allowDuplicated: z.boolean().optional() }, ({ contentId: id, filePath, comment, minorEdit, allowDuplicated }) => invoke(() => client.addAttachment(id, filePath, { comment, minorEdit, allowDuplicated })));
  server.tool("confluence_update_attachment", "Update attachment metadata", { contentId, attachmentId: z.string(), body: z.record(z.unknown()) }, ({ contentId: id, attachmentId, body }) => invoke(() => client.updateAttachment(id, attachmentId, body)));
  server.tool("confluence_update_attachment_data", "Upload a new binary attachment version", { contentId, attachmentId: z.string(), filePath: z.string(), comment: z.string().optional(), minorEdit: z.boolean().optional() }, ({ contentId: id, attachmentId, filePath, comment, minorEdit }) => invoke(() => client.updateAttachmentData(id, attachmentId, filePath, { comment, minorEdit })));
  server.tool("confluence_delete_attachment", "Delete an attachment", { contentId, attachmentId: z.string() }, ({ contentId: id, attachmentId }) => invoke(() => client.deleteAttachment(id, attachmentId)));

  server.tool("confluence_get_labels", "List labels on Confluence content", { contentId, prefix: z.string().optional(), ...paging }, ({ contentId: id, prefix, limit, start }) => invoke(() => client.getLabels(id, { prefix, limit, start })));
  server.tool("confluence_add_labels", "Add labels to Confluence content", { contentId, labels: z.array(z.record(z.unknown())) }, ({ contentId: id, labels }) => invoke(() => client.addLabels(id, labels)));
  server.tool("confluence_remove_label", "Remove a label from Confluence content", { contentId, label: z.string() }, ({ contentId: id, label }) => invoke(() => client.removeLabel(id, label)));

  server.tool("confluence_get_content_properties", "List content properties", { contentId, ...paging }, ({ contentId: id, limit, start, expand }) => invoke(() => client.getContentProperties(id, { limit, start, expand })));
  server.tool("confluence_get_content_property", "Get one content property", { contentId, key: z.string(), expand: paging.expand }, ({ contentId: id, key, expand }) => invoke(() => client.getContentProperty(id, key, { expand })));
  server.tool("confluence_create_content_property", "Create a content property", { contentId, property: z.record(z.unknown()) }, ({ contentId: id, property }) => invoke(() => client.createContentProperty(id, property)));
  server.tool("confluence_update_content_property", "Update a content property with version coordination", { contentId, key: z.string(), property: z.record(z.unknown()), expand: paging.expand }, ({ contentId: id, key, property, expand }) => invoke(() => client.updateContentProperty(id, key, property, { expand })));
  server.tool("confluence_delete_content_property", "Delete a content property", { contentId, key: z.string() }, ({ contentId: id, key }) => invoke(() => client.deleteContentProperty(id, key)));

  server.tool("confluence_get_restrictions", "Get content restrictions grouped by operation", { contentId, operation: z.string().optional(), ...paging }, ({ contentId: id, operation, limit, start, expand }) => invoke(() => client.getRestrictions(id, operation, { limit, start, expand })));
  server.tool("confluence_update_restrictions", "Replace content restrictions for selected operations", { contentId, restrictions: z.array(z.record(z.unknown())), expand: paging.expand }, ({ contentId: id, restrictions, expand }) => invoke(() => client.updateRestrictions(id, restrictions, { expand })));

  server.tool("confluence_get_watchers", "List users watching Confluence content", { contentId, ...paging }, ({ contentId: id, limit, start }) => invoke(() => client.getWatchers(id, { limit, start })));
  server.tool("confluence_get_current_user", "Get the authenticated Confluence user", {}, () => invoke(() => client.getCurrentUser()));
  server.tool("confluence_get_user", "Get a Confluence user by username or key", { username: z.string().optional(), key: z.string().optional(), expand: paging.expand }, ({ username, key, expand }) => invoke(() => client.getUser({ username, key, expand })));
  server.tool("confluence_get_users", "List registered Confluence users", { ...paging, expand: paging.expand }, ({ limit, start, expand }) => invoke(() => client.getUsers({ limit: limit ?? config.defaultPageSize, start, expand })));

  server.tool(
    "confluence_get_all_comments",
    "Fetch every comment and nested reply for a document across all pagination pages",
    { contentId },
    ({ contentId: id }) => invoke(async () => ({ results: await paginate((start, limit) => client.getComments(id, { start, limit, depth: "all", location: ["inline", "footer", "resolved"], expand: "body.storage,extensions.inlineProperties,extensions.resolution" }), { limit: config.defaultPageSize }) })),
  );
}
