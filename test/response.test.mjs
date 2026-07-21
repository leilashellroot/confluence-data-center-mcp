import assert from "node:assert/strict";
import test from "node:test";

const { storageToText, shapeFullContent } = await import("../dist/response.js");

test("converts storage markup into readable text while preserving content", () => {
  const storage = "<p>Hello &amp; <strong>world</strong></p><ul><li>One</li><li>Two</li></ul>";
  assert.match(storageToText(storage), /Hello & world/);
  assert.match(storageToText(storage), /- One/);
  assert.match(storageToText(storage), /- Two/);

  const shaped = shapeFullContent({ body: { storage: { value: storage, representation: "storage" } } });
  assert.equal(shaped.body.storage.value, storage);
  assert.match(shaped.body.text.value, /Hello & world/);
});
