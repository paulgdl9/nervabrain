import assert from "node:assert/strict";
import test from "node:test";
import { assistantEditRequested, relevantAssistantNotes, type VaultNote } from "@/lib/vault";

function note(title: string, path: string, content: string): VaultNote {
  return { id: path, title, relativePath: path, folder: path.split("/")[0], kind: "wiki", data: {}, content, excerpt: "", tags: [], links: [], status: "", mtime: "2026-01-01T00:00:00.000Z" };
}

test("assistant retrieval searches every Markdown folder and ranks title matches first", () => {
  const notes = [
    note("Divers", "03-Wiki/divers.md", "Le vélo apparaît seulement dans le contenu."),
    note("Objectif vélo", "08-Projects/Cyclisme/Objectif.md", "Préparation personnelle."),
    note("Sans rapport", "12-Business/Client.md", "Aucune activité sportive."),
  ];
  assert.deepEqual(relevantAssistantNotes(notes, "Quel est mon objectif vélo ?").map((entry) => entry.relativePath), [
    "08-Projects/Cyclisme/Objectif.md",
    "03-Wiki/divers.md",
  ]);
});

test("a QCM correction is a retrieval question, not an order to edit the vault", () => {
  assert.equal(assistantEditRequested("Quel corrigé du QCM faut-il retenir ?"), false);
  assert.equal(assistantEditRequested("Donne-moi le corrigé attendu pour les VLE."), false);
  assert.equal(assistantEditRequested("Corrige la fiche IRM dans le vault."), true);
  assert.equal(assistantEditRequested("Peux-tu corriger le plan ?"), true);
});
