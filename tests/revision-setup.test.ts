import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRevisionDashboard, getRevisionSetup, markdownHasUsefulRevisionContent } from "../src/lib/radio";
import { configureRevisionProgram, readNote, writeRawNote } from "../src/lib/vault";

test("revision content requires more than empty headings", () => {
  assert.equal(markdownHasUsefulRevisionContent("# Droit\n\n## À retenir"), false);
  assert.equal(markdownHasUsefulRevisionContent("# Droit\n\n<!--\nExemple de contenu\n-->"), false);
  assert.equal(markdownHasUsefulRevisionContent("# Droit\n\n- [Cours officiel](https://example.com)"), true);
});

test("guided revision setup is idempotent and waits for useful content", async (t) => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-revision-setup-"));
  process.env.SECOND_BRAIN_VAULT = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  });

  await configureRevisionProgram({
    title: "Partiels de septembre",
    examDate: "2026-09-15",
    modules: ["Droit des contrats", "Statistiques"],
    locale: "fr",
  });
  const setup = await getRevisionSetup();
  assert.equal(setup.title, "Partiels de septembre");
  assert.deepEqual(setup.moduleLabels, ["Droit des contrats", "Statistiques"]);
  assert.equal(await getRevisionDashboard(), null);

  const coursePath = "08-Projects/Revisions/Fiche-droit-des-contrats.md";
  const course = await readNote(coursePath);
  assert.ok(course);
  await writeRawNote(coursePath, course.data, "# Droit des contrats\n\nLa force obligatoire lie les parties.", { expectedMtime: course.mtime });

  await configureRevisionProgram({
    title: "Partiels de septembre",
    examDate: "2026-09-15",
    modules: ["Droit des contrats", "Statistiques"],
    locale: "fr",
  });
  assert.match((await readNote(coursePath))?.content || "", /force obligatoire/);
  assert.ok(await getRevisionDashboard());
  assert.equal((await fs.readdir(path.join(root, "08-Projects", "Revisions"))).length, 13);
});
