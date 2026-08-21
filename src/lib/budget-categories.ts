export type BudgetCategoryItem = {
  key: string;
  label: string;
  meta: string;
  amount: number;
  color: string;
};

const BUDGET_CATEGORY_COLORS: Record<string, string> = {
  housing: "var(--chart-1)",
  insurance: "var(--chart-8)",
  credit: "var(--chart-5)",
  health: "var(--chart-9)",
  transport: "var(--chart-6)",
  taxes: "var(--chart-7)",
  food: "var(--chart-2)",
  leisure: "var(--chart-4)",
  shopping: "var(--chart-9)",
  savings: "var(--chart-2)",
  subscriptions: "var(--chart-8)",
  ai: "var(--chart-4)",
  banking: "var(--chart-1)",
  cloud: "var(--chart-6)",
  dating: "var(--chart-9)",
  energy: "var(--chart-3)",
  fitness: "var(--chart-2)",
  gaming: "var(--chart-8)",
  mobility: "var(--chart-6)",
  news: "var(--chart-7)",
  productivity: "var(--chart-1)",
  security: "var(--chart-5)",
  streaming: "var(--chart-4)",
  telecom: "var(--chart-6)",
  other: "var(--muted-2)",
  autres: "var(--muted-2)",
};

export function budgetCategoryColor(category: string) {
  return BUDGET_CATEGORY_COLORS[category.trim().toLowerCase()] || BUDGET_CATEGORY_COLORS.other;
}

export function prepareBudgetCategories(
  items: BudgetCategoryItem[],
  overflowText: (count: number) => Pick<BudgetCategoryItem, "label" | "meta">,
  limit = 7,
) {
  const sorted = items.filter((item) => Number.isFinite(item.amount) && item.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((sum, item) => sum + item.amount, 0);
  const maxItems = Math.max(1, Math.floor(limit));
  if (sorted.length <= maxItems) return { items: sorted, total };

  const visible = sorted.slice(0, maxItems - 1);
  const overflow = sorted.slice(maxItems - 1);
  return {
    items: [...visible, {
      key: "budget-category-other",
      ...overflowText(overflow.length),
      amount: overflow.reduce((sum, item) => sum + item.amount, 0),
      color: budgetCategoryColor("other"),
    }],
    total,
  };
}
