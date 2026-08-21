import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InboxWorkspace, WikiWorkspace } from "../src/components/KnowledgeWorkspaces";
import { LanguageProvider } from "../src/components/LanguageProvider";

function note(overrides: Partial<import("../src/lib/vault").VaultNote> = {}): import("../src/lib/vault").VaultNote {
  return {
    id: "03-Wiki/Guide.md",
    title: "Guide",
    relativePath: "03-Wiki/Guide.md",
    folder: "03-Wiki",
    kind: "wiki",
    data: {},
    content: "# Guide",
    excerpt: "Un guide utile",
    tags: [],
    links: [],
    status: "draft",
    mtime: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

const render = (children: React.ReactNode) => renderToStaticMarkup(
  <LanguageProvider initialLocale="fr">{children}</LanguageProvider>,
);

test("Inbox and Library explain the knowledge pipeline", () => {
  const explanation = /Chaque capture est routée automatiquement par l’IA/;

  assert.match(render(<InboxWorkspace notes={[]} />), explanation);
  assert.match(render(<WikiWorkspace notes={[]} />), explanation);
});

test("Wiki drafts expose publish and archive actions", () => {
  const html = render(<WikiWorkspace notes={[note()]} initialMode="drafts" />);
  assert.match(html, /Publier<\/button>/);
  assert.match(html, /Archiver<\/button>/);
  assert.match(html, /href="\/edit\/03-Wiki\/Guide\.md"/);
});

test("processed captures link to their generated Wiki note", () => {
  const capture = note({
    id: "01-Inbox/Capture.md",
    relativePath: "01-Inbox/Capture.md",
    folder: "01-Inbox",
    kind: "capture",
    status: "processed",
    data: { wiki_note: "03-Wiki/Guide.md" },
  });
  assert.match(render(<InboxWorkspace notes={[capture]} />), /href="\/note\/03-Wiki\/Guide\.md"/);
});

test("Inbox exposes the AI route without manual triage controls", () => {
  const capture = note({
    id: "01-Inbox/Capture.md",
    relativePath: "01-Inbox/Capture.md",
    folder: "01-Inbox",
    kind: "capture",
    status: "processed",
    data: { route_destination: "task", derived_notes: ["05-Tasks/Action.md"] },
  });
  const html = render(<InboxWorkspace notes={[capture]} />);
  assert.match(html, /href="\/note\/05-Tasks\/Action\.md"/);
  assert.match(html, />task<\/span>/);
  assert.doesNotMatch(html, /aria-label="Statut de la capture"/);
});
