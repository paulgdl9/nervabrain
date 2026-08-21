import assert from "node:assert/strict";
import test from "node:test";
import { parseRadioFlashcards, parseRadioQuiz, parseRevisionModuleSources } from "../src/lib/radio";

test("radio flashcard parser supports inline and next-line answers", () => {
  const cards = parseRadioFlashcards([
    "**1. Q — Quel signal ?** R — Le signal T1.",
    "",
    "**2. Q — Quel risque ?**",
    "R — Le risque testé.",
  ].join("\n"), "irm");

  assert.deepEqual(cards, [
    { id: "irm-f-1", question: "Quel signal ?", answer: "Le signal T1." },
    { id: "irm-f-2", question: "Quel risque ?", answer: "Le risque testé." },
  ]);
});

test("radio QCM parser preserves choices, correction and explanation", () => {
  const quiz = parseRadioQuiz(`## Questions
### Q1 — Sécurité
À propos de la zone IRM :
A. Elle est contrôlée
B. Elle est libre
C. Elle impose un dépistage

## Corrections
| N° | Réponse | Explication |
| --- | --- | --- |
| 1 | A, C | Contrôle et dépistage sont requis. |
`, "irm");

  assert.equal(quiz.length, 1);
  assert.equal(quiz[0].prompt, "À propos de la zone IRM :");
  assert.deepEqual(quiz[0].answers, ["A", "C"]);
  assert.equal(quiz[0].options.length, 3);
  assert.match(quiz[0].explanation, /dépistage/);
});

test("revision modules come from the vault program instead of application code", () => {
  const modules = parseRevisionModuleSources([
    "irm|IRM · bases et sécurité|IRM|blue|IRM",
    "bad/path|Ignored|Ignored|red|../secret",
  ]);

  assert.equal(modules.length, 1);
  assert.deepEqual(modules[0], {
    id: "irm",
    label: "IRM · bases et sécurité",
    shortLabel: "IRM",
    accent: "blue",
    exhaustive: "Fiche-Exhaustive-IRM.md",
    highYield: "Fiche-IRM.md",
    flashcards: "Flashcards-IRM.md",
    quiz: "QCM-IRM.md",
    palace: "Palais-Mental-IRM.md",
    recall: "Récitation-IRM.md",
  });
});
