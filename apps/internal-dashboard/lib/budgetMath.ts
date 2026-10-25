// Accounting rules kept pure and separately tested. Only real USD cash-flow
// is included in the recorded balance. Issued/redeemed PIXL pixels are not
// program income or money paid to reviewers.
export type Direction = "income" | "expense";
export type EntryState = "planned" | "settled";

export const BUDGET_CATEGORIES = {
  program_funding: { label: "Program funding received", direction: "income" },
  sponsorship: { label: "Sponsorship", direction: "income" },
  donation: { label: "Donation", direction: "income" },
  fine_recovered: { label: "Fine recovered", direction: "income" },
  other_income: { label: "Other income", direction: "income" },
  contractor: { label: "Contractors", direction: "expense" },
  security_bounty: { label: "Security bounties", direction: "expense" },
  fine_paid: { label: "Fines paid", direction: "expense" },
  reviewer_cash: { label: "Reviewer cash payments", direction: "expense" },
  hosting: { label: "Hosting / infrastructure", direction: "expense" },
  shipping_extra: { label: "Additional shipping costs", direction: "expense" },
  operations: { label: "Operations / services", direction: "expense" },
  other_expense: { label: "Other expenses", direction: "expense" },
} as const satisfies Record<string, { label: string; direction: Direction }>;

export type BudgetCategory = keyof typeof BUDGET_CATEGORIES;

export function parseUsdToCents(raw: string): number | null {
  const s = raw.trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(s)) return null;
  const [dollars, cents = ""] = s.split(".");
  const n = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export interface MoneyEntry {
  direction: Direction;
  state: EntryState;
  amountCents: number;
  voided: boolean;
}

export function summarizeBudget(entries: readonly MoneyEntry[], shopSpentCents: number) {
  let income = 0, expenses = 0, plannedIncome = 0, plannedExpenses = 0, settledIncomeCount = 0;
  for (const row of entries) {
    if (row.voided) continue;
    if (row.state === "planned") {
      if (row.direction === "income") plannedIncome += row.amountCents;
      else plannedExpenses += row.amountCents;
    } else if (row.direction === "income") {
      income += row.amountCents;
      settledIncomeCount++;
    } else expenses += row.amountCents;
  }
  return {
    incomeCents: income,
    manualExpensesCents: expenses,
    shopSpentCents,
    totalExpensesCents: expenses + shopSpentCents,
    recordedNetCents: income - expenses - shopSpentCents,
    plannedIncomeCents: plannedIncome,
    plannedExpensesCents: plannedExpenses,
    hasRecordedIncome: settledIncomeCount > 0,
  };
}
