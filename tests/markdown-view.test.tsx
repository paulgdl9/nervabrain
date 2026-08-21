import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../src/components/LanguageProvider";
import { MarkdownView, resizeMarkdownColumn, revealMarkdownImageFallback } from "../src/components/MarkdownView";

function renderMarkdown(content: string, locale: "fr" | "en" = "fr", editableChecklist?: { relativePath: string; mtime: string }) {
  return renderToStaticMarkup(
    <LanguageProvider initialLocale={locale}>
      <MarkdownView content={content} editableChecklist={editableChecklist} />
    </LanguageProvider>,
  );
}

test("Markdown images stay safe, responsive, and lazy", () => {
  const content = [
    "![Capture du tableau](https://example.com/photo.jpg)",
    "",
    "![[photo.png]]",
    "",
    "![Danger](javascript:alert(1))",
  ].join("\n");
  const html = renderMarkdown(content);
  const english = renderMarkdown(content, "en");

  assert.match(html, /src="https:\/\/example\.com\/photo\.jpg"/);
  assert.match(html, /alt="Capture du tableau"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /max-width:100%/);
  assert.match(html, /height:auto/);
  assert.doesNotMatch(html, /\/search\?q=photo\.png/);
  assert.match(html, /!\[\[photo\.png\]\]/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /src=""/);
  assert.match(html, /class="markdown-image-fallback" hidden="" role="status" aria-live="polite"/);
  assert.match(html, /Image indisponible/);
  assert.match(html, /Ouvrir l’image/);
  assert.match(html, /href="https:\/\/example\.com\/photo\.jpg"/);
  assert.match(english, /Image unavailable/);
  assert.match(english, /Open image/);

  const image = { hidden: false };
  const fallback = { hidden: true };
  revealMarkdownImageFallback(image, fallback);
  assert.deepEqual({ image: image.hidden, fallback: fallback.hidden }, { image: true, fallback: false });
});

test("Markdown checklists stay read-only unless a Wiki note opts in", () => {
  const content = "- [ ] Vérifier le résultat";
  const readOnly = renderMarkdown(content);
  const editable = renderMarkdown(content, "fr", { relativePath: "03-Wiki/Guide.md", mtime: "2026-07-21T12:00:00.000Z" });

  assert.match(readOnly, /disabled=""/);
  assert.doesNotMatch(editable, /disabled=""/);
  assert.match(editable, /aria-label="Vérifier le résultat"/);
});

test("Markdown tables scroll, resize and path-qualified wikilinks open the note directly", () => {
  const html = renderMarkdown([
    "[[08-Projects/SaaS-Second-Brain/Feedback.md|Nerva Brain — Feedback]]",
    "",
    "| Jour | Retour détaillé |",
    "|---|---|",
    "| J1 | Le contenu complet reste accessible. |",
  ].join("\n"));

  assert.match(html, /href="\/note\/08-Projects\/SaaS-Second-Brain\/Feedback\.md"/);
  assert.match(html, /class="markdown-table-scroll markdown-table-resizable"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /class="markdown-column-resizer"/);
  assert.match(html, /aria-label="Redimensionner la colonne Retour détaillé"/);
  assert.deepEqual(resizeMarkdownColumn([160, 240], 1, 40), [160, 280]);
  assert.deepEqual(resizeMarkdownColumn([160, 120], 1, -80), [160, 96]);
});
