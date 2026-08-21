import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefView } from "../src/components/BriefView";
import { BriefDetailSetting } from "../src/components/BriefDetailSetting";
import { LanguageProvider } from "../src/components/LanguageProvider";
import { WeeklyWorkspace } from "../src/components/WeeklyWorkspace";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<LanguageProvider initialLocale="fr">{node}</LanguageProvider>);
}

test("Daily and Weekly views hide legacy technical references", () => {
  const daily = render(createElement(BriefView, { content: [
    "## 🗓️ Daily Brief — 2026-07-21",
    "### 📌 Suivi",
    "La priorité avance [Task: Livrer] grâce à [[05-Tasks/Livrer.md]].",
    "### Sources",
    "- SOURCE-DAILY-INTERDITE.md",
  ].join("\n") }));
  const weekly = render(createElement(WeeklyWorkspace, { reviews: [{
    id: "weekly", path: "07-Weekly/2026-W29.md", week: "2026-W29", start: "2026-07-13", end: "2026-07-19", href: "/weekly",
    feedback: "", feedbackReason: "", suggestions: [],
    content: "## Résultats\nLe résultat est vérifié [Task: Livrer].\n## Sources\nSOURCE-WEEKLY-INTERDITE.md",
  }] }));

  for (const html of [daily, weekly]) {
    assert.doesNotMatch(html, /\.md\b/i);
    assert.doesNotMatch(html, /\[Task:/i);
    assert.doesNotMatch(html, /SOURCE-(?:DAILY|WEEKLY)-INTERDITE/);
  }
});

test("brief detail setting exposes three labeled native range positions", () => {
  const html = render(<BriefDetailSetting value="detailed" />);
  assert.match(html, /type="range"/);
  assert.match(html, /name="briefDetail"/);
  assert.match(html, /min="0"/);
  assert.match(html, /max="2"/);
  assert.match(html, /aria-valuetext="Détaillé"/);
  for (const label of ["Concis", "Équilibré", "Détaillé"]) assert.match(html, new RegExp(label));
});
