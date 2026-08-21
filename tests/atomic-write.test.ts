import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteFile, FileWriteConflictError } from "../src/lib/atomic-write";

test("atomic writes to the same path are serialized and leave no temporary files", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-atomic-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "note.md");
  await Promise.all([
    atomicWriteFile(file, "first"),
    atomicWriteFile(file, "second"),
    atomicWriteFile(file, "last"),
  ]);
  assert.equal(await fs.readFile(file, "utf8"), "last");
  assert.deepEqual(await fs.readdir(dir), ["note.md"]);
});

test("optimistic writes reject a stale mtime", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-conflict-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "note.md");
  await atomicWriteFile(file, "original");
  const expectedMtime = (await fs.stat(file)).mtime.toISOString();
  await atomicWriteFile(file, "newer", { expectedMtime });
  await assert.rejects(
    atomicWriteFile(file, "stale", { expectedMtime }),
    FileWriteConflictError,
  );
  assert.equal(await fs.readFile(file, "utf8"), "newer");
});

test("an explicit shared mode survives atomic replacement", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-shared-mode-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "note.md");
  await atomicWriteFile(file, "first", { mode: 0o660 });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o660);

  await fs.chmod(file, 0o600);
  await atomicWriteFile(file, "replacement", { mode: 0o660 });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o660);
});
