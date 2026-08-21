import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileTree, type FileNode } from "../src/components/ui/file-tree";

test("the vault tree colors roots and only opens the active branch", () => {
  const data: FileNode[] = [
    { name: "01-Inbox", type: "folder", path: "01-Inbox", children: [{ name: "capture.md", type: "file", path: "01-Inbox/capture.md" }] },
    { name: "10-Finance", type: "folder", path: "10-Finance", children: [{ name: "btc.md", type: "file", path: "10-Finance/btc.md" }] },
  ];
  const html = renderToStaticMarkup(<FileTree activePath="10-Finance/btc.md" data={data} />);

  assert.match(html, /text-amber-500/);
  assert.match(html, /text-green-500/);
  assert.match(html, />btc\.md</);
  assert.doesNotMatch(html, />capture\.md</);
});
