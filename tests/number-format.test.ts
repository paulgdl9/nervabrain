import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Intl separates the compact suffix and the currency with non-breaking spaces. */
function normalize(value: string) {
  return value.replace(/[   ]/g, " ");
}

/**
 * These run under Node's ICU. The expectations below are what the browser's ICU
 * produces, so a failure here is exactly the hydration error the finance widget
 * threw: server "34,0 k €" against client "34 k €".
 */
test("compact currency renders identically under Node and browser ICU", () => {
  const compact = (value: number) => normalize(new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", notation: "compact",
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  }).format(value));

  // A rounded decimal of zero is where the two ICU builds used to disagree.
  for (const value of [33950, 34000, 34049, 34000.4]) {
    assert.equal(compact(value), "34 k €", `${value} must drop the trailing zero`);
  }
  assert.equal(compact(1926), "1,9 k €");
  assert.equal(compact(174.42), "174,4 €");

  // Without the explicit minimum the spelling is ICU-version dependent: Node 20
  // keeps the trailing zero ("34,0 k €") while Node 24 and browsers drop it.
  // Pinning either spelling would pin the runtime, not our behaviour — that
  // instability is precisely why every formatter sets the minimum above.
  const ambiguous = normalize(new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1,
  }).format(34000));
  assert.ok(
    ["34 k €", "34,0 k €"].includes(ambiguous),
    `unpinned compact currency rendered unexpectedly: ${ambiguous}`,
  );
});

test("every compact currency formatter pins its minimum fraction digits", () => {
  const files = [
    "src/components/Finance.tsx",
    "src/components/ui/FinanceMetricChart.tsx",
    "src/lib/business-view.ts",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const blocks = source.split(/notation:\s*compact\s*\?\s*"compact"/).slice(1);
    assert.ok(blocks.length, `${file} no longer has a compact formatter`);
    for (const block of blocks) {
      // Up to the end of the options object, comments included.
      const options = block.slice(0, block.indexOf("}"));
      assert.match(options, /minimumFractionDigits:/, `${file}: compact formatter without an explicit minimum`);
    }
  }
});
