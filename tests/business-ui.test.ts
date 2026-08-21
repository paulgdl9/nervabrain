import assert from "node:assert/strict";
import test from "node:test";
import { formatBusinessMoney, matchesBusinessCurrency, matchesBusinessSearch } from "../src/lib/business-view";

test("business search ignores case and accents", () => {
  const prospect = "École Supérieure · MARIE Noël · Recommandation";

  assert.equal(matchesBusinessSearch(prospect, "ecole superieure"), true);
  assert.equal(matchesBusinessSearch(prospect, "marie noel"), true);
  assert.equal(matchesBusinessSearch(prospect, "linkedin"), false);
});

test("business monetary totals can keep only the configured currency", () => {
  const records = [
    { amount: 1_000, currency: "EUR" },
    { amount: 900, currency: "CHF" },
    { amount: 500, currency: "eur" },
  ];
  const included = records.filter((record) => matchesBusinessCurrency(record.currency, "EUR"));

  assert.equal(included.reduce((sum, record) => sum + record.amount, 0), 1_500);
  assert.deepEqual(records.filter((record) => !matchesBusinessCurrency(record.currency, "EUR")).map((record) => record.currency), ["CHF"]);
});

test("business compact money keeps zero stable between runtimes", () => {
  assert.equal(formatBusinessMoney(0, "EUR", "fr", true).replace(/\s/g, " "), "0 €");
  assert.notEqual(formatBusinessMoney(1_500, "EUR", "fr", true), formatBusinessMoney(1_500, "EUR", "fr"));
});
