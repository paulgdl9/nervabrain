import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readFinanceHistory, recordFinanceSnapshot, type VaultNote } from "../src/lib/vault";

function position(id: string, type: string, value: number, change: number): VaultNote {
  return {
    id,
    title: id,
    relativePath: `10-Finance/${id}.md`,
    folder: "10-Finance",
    kind: "finance-position",
    data: { asset_type: type, value_base: value, market_change_percent: change },
    content: "",
    excerpt: "",
    tags: [],
    links: [],
    status: "active",
    mtime: new Date().toISOString(),
  };
}

test("finance snapshots keep one daily total with per-class history", async (t) => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "memo-finance-history-"));
  process.env.SECOND_BRAIN_VAULT = vault;
  t.after(async () => {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(vault, { recursive: true, force: true });
  });

  const first = await recordFinanceSnapshot([
    position("world-etf", "etf", 8_000, 2),
    position("cash", "savings", 2_000, 0),
  ], "EUR");
  assert.equal(first.length, 2);
  assert.equal(first[0].estimated, true);
  assert.equal(first[1].total, 10_000);
  assert.deepEqual(first[1].byType, { etf: 8_000, savings: 2_000 });
  assert.equal(first[1].byAsset?.["10-Finance/world-etf.md"].value, 8_000);
  assert.equal(first[1].byAsset?.["10-Finance/cash.md"].value, 2_000);

  const updated = await recordFinanceSnapshot([position("world-etf", "etf", 8_500, 2)], "EUR");
  assert.equal(updated.length, 2);
  assert.equal(updated[1].total, 8_500);

  const readOnly = await readFinanceHistory("EUR");
  assert.deepEqual(readOnly, JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(await readFinanceHistory("USD"), []);
});
