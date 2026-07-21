import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";

const { getContentContext } = await import("../dist/context.js");
const { setContext } = await import("../dist/client.js");

function json(res, body) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

test("aggregates the full document and nested comment threads across pages", async () => {
  const server = createServer((req, res) => {
    if (req.url.startsWith("/rest/api/content/42?")) {
      json(res, {
        id: "42",
        type: "page",
        title: "Context page",
        body: { storage: { value: "<p>Complete document</p>", representation: "storage" } },
      });
      return;
    }
    if (req.url.startsWith("/rest/api/content/42/child/comment")) {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("start") === "1") {
        json(res, {
          results: [{
            id: "101",
            type: "comment",
            container: { id: "100", type: "comment" },
            body: { storage: { value: "<p>Reply</p>", representation: "storage" } },
          }],
          start: 1,
          limit: 1,
          size: 1,
          totalCount: 2,
        });
      } else {
        json(res, {
          results: [{
            id: "100",
            type: "comment",
            container: { id: "42", type: "page" },
            body: { storage: { value: "<p>Root comment</p>", representation: "storage" } },
            extensions: { inlineProperties: { marker: "selection" } },
          }],
          start: 0,
          limit: 1,
          size: 1,
          totalCount: 2,
        });
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  process.env.CONFLUENCE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CONFLUENCE_API_TOKEN = "test-token";
  process.env.CONFLUENCE_DEFAULT_PAGE_SIZE = "1";
  setContext(undefined);

  try {
    const context = await getContentContext("42", 1);
    assert.equal(context.content.id, "42");
    assert.equal(context.documentText, "Complete document");
    assert.equal(context.commentCount, 2);
    assert.equal(context.threadCount, 1);
    assert.equal(context.comments.length, 1);
    assert.equal(context.comments[0].children[0].body.text.value, "Reply");
    assert.equal(context.comments[0].inlineProperties.marker, "selection");
  } finally {
    setContext(undefined);
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
