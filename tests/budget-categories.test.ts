import assert from "node:assert/strict";
import test from "node:test";
import { budgetCategoryColor, prepareBudgetCategories, type BudgetCategoryItem } from "../src/lib/budget-categories";

function category(key: string, amount: number): BudgetCategoryItem {
  return { key, label: key, meta: key, amount, color: "#000" };
}

test("budget categories keep simple semantic colours regardless of their order", () => {
  assert.equal(budgetCategoryColor("savings"), "var(--chart-2)");
  assert.equal(budgetCategoryColor("credit"), "var(--chart-5)");
  assert.equal(budgetCategoryColor("housing"), "var(--chart-1)");
  assert.equal(budgetCategoryColor("unknown"), "var(--muted-2)");
});

test("budget categories preserve order and total while grouping localized overflow", () => {
  const result = prepareBudgetCategories([
    category("fifty", 50),
    category("zero", 0),
    category("eighty", 80),
    category("twenty", 20),
    category("seventy", 70),
    category("sixty", 60),
    category("negative", -5),
  ], (count) => ({ label: "Other", meta: `${count} grouped categories` }), 4);

  assert.equal(result.total, 280);
  assert.deepEqual(result.items.map((item) => item.label), ["eighty", "seventy", "sixty", "Other"]);
  assert.equal(result.items.at(-1)?.meta, "2 grouped categories");
  assert.equal(result.items.at(-1)?.amount, 70);
});

test("budget categories return an empty zero-total view", () => {
  assert.deepEqual(prepareBudgetCategories(
    [category("zero", 0), category("negative", -10)],
    () => ({ label: "Other", meta: "Grouped categories" }),
  ), { items: [], total: 0 });
});
