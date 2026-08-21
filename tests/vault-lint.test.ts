import assert from "node:assert/strict";
import test from "node:test";
import type { VaultNote } from "../src/lib/vault";
import { lintVaultNotes } from "../src/lib/vault-lint";

function note(path: string, title: string, patch: Partial<VaultNote> = {}): VaultNote {
  return {
    id: path,
    relativePath: path,
    folder: path.split("/")[0],
    title,
    kind: "wiki",
    data: { type: "wiki", title, status: "draft" },
    content: `# ${title}`,
    excerpt: "",
    tags: [],
    links: [],
    status: "draft",
    mtime: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

test("vault lint reports broken sources, ambiguous links, duplicates and tag casing", () => {
  const notes = [
    note("03-Wiki/one.md", "Shared", { tags: ["AI"], links: ["Shared"] }),
    note("03-Wiki/two.md", "Shared", { tags: ["ai"] }),
    note("03-Wiki/source.md", "Source", { data: {
      type: "wiki", title: "Source", status: "draft", sources: ["01-Inbox/missing.md"],
    } }),
  ];
  const report = lintVaultNotes(notes);
  assert.ok(report.issues.some((issue) => issue.code === "source.missing"));
  assert.ok(report.issues.some((issue) => issue.code === "wikilink.ambiguous"));
  assert.ok(report.issues.some((issue) => issue.code === "title.duplicate"));
  assert.ok(report.issues.some((issue) => issue.code === "tag.inconsistent-case"));
});

test("vault lint accepts a capture and its derived wiki sharing a title", () => {
  const capture = note("01-Inbox/source.md", "Shared", {
    kind: "capture",
    data: {
      type: "capture",
      title: "Shared",
      status: "processed",
      source: "rss",
      captured_at: "2026-01-01T00:00:00.000Z",
    },
    status: "processed",
  });
  const wiki = note("03-Wiki/derived.md", "Shared", {
    data: {
      type: "wiki",
      title: "Shared",
      status: "draft",
      source_note: capture.relativePath,
    },
  });

  const report = lintVaultNotes([capture, wiki]);
  assert.equal(report.issues.some((issue) => issue.code === "title.duplicate"), false);
});

test("vault lint does not impose a generic schema on unmanaged markdown", () => {
  const skill = note("09-Skills/example/SKILL.md", "Example skill", {
    kind: "",
    data: {},
    status: "",
  });

  const report = lintVaultNotes([skill]);
  assert.equal(report.issues.some((issue) => issue.code === "schema.missing-field"), false);
});
