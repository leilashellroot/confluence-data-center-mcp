import { getContext, paginate, type JsonObject } from "./client.js";
import { shapeFullContent, storageToText } from "./response.js";

interface CommentNode extends JsonObject {
  id: string;
  parentId: string | null;
  children: CommentNode[];
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function getParentId(comment: JsonObject): string | null {
  const container = comment.container as JsonObject | undefined;
  if (container?.type === "comment") return idOf(container.id) ?? null;

  const ancestors = Array.isArray(comment.ancestors) ? comment.ancestors : [];
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index] as JsonObject;
    if (ancestor.type === "comment") return idOf(ancestor.id) ?? null;
  }

  const extensions = comment.extensions as JsonObject | undefined;
  const inlineProperties = extensions?.inlineProperties as JsonObject | undefined;
  return idOf(inlineProperties?.parentCommentId) ?? null;
}

function commentNode(comment: JsonObject): CommentNode {
  const shaped = shapeFullContent(comment);
  const extensions = shaped.extensions as JsonObject | undefined;
  const resolution = extensions?.resolution;
  const inlineProperties = extensions?.inlineProperties;
  return {
    ...shaped,
    id: idOf(shaped.id) ?? "",
    parentId: getParentId(shaped),
    location: inlineProperties ? "inline" : "footer",
    resolution,
    inlineProperties,
    children: [],
  };
}

function buildThreads(comments: JsonObject[]): CommentNode[] {
  const nodes = comments.map(commentNode);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: CommentNode[] = [];

  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getContentContext(contentId: string, pageSize: number): Promise<JsonObject> {
  const { client } = getContext();
  const content = await client.getContent(contentId, {
    expand: "body.storage,body.view,version,history,space,ancestors,metadata.labels,restrictions",
  });
  const comments = await paginate(
    (start, limit) => client.getComments(contentId, {
      start,
      limit,
      depth: "all",
      location: ["inline", "footer", "resolved"],
      expand: "body.storage,body.view,version,history,extensions.inlineProperties,extensions.resolution",
    }),
    { limit: pageSize },
  );

  const deduplicated = [...new Map(comments.map((comment) => [idOf(comment.id) ?? JSON.stringify(comment), comment])).values()];
  const body = content.body as JsonObject | undefined;
  const storage = body?.storage as JsonObject | undefined;

  return {
    content: shapeFullContent(content),
    documentText: typeof storage?.value === "string" ? storageToText(storage.value) : null,
    comments: buildThreads(deduplicated),
    commentCount: deduplicated.length,
    threadCount: deduplicated.filter((comment) => !getParentId(comment)).length,
    complete: true,
    commentQuery: {
      depth: "all",
      locations: ["inline", "footer", "resolved"],
      paginated: true,
      deduplicated: comments.length - deduplicated.length,
    },
  };
}
