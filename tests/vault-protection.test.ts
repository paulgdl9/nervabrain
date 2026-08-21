import assert from "node:assert/strict";
import test from "node:test";
import { isProtectedVaultPath } from "../src/lib/vault-protection";

test("vault protection locks module infrastructure but not ordinary notes", () => {
  for (const path of [
    "00-System/Context.md",
    "09-Skills/synthesize-daily/SKILL.md",
    "11-Custom/_registry/lab.md",
    "08-Projects/Trail-26K/Journal.md",
    "08-Projects/SaaS-Second-Brain/Feedback.md",
  ]) assert.equal(isProtectedVaultPath(path), true, path);

  for (const path of ["02-Raw/note.md", "03-Wiki/guide.md", "05-Tasks/task.md"]) {
    assert.equal(isProtectedVaultPath(path), false, path);
  }
});
