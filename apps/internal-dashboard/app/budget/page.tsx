import { requirePage } from "@/lib/guard";
import { getBudgetData } from "@/lib/budget";
import { getBudgetCash } from "@/lib/budgetCash";
import { getBudgetPosition } from "@/lib/budgetPosition";
import { BudgetView } from "./BudgetView";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  await requirePage("owner");
  const [data, position, cash] = await Promise.all([getBudgetData(), getBudgetPosition(), getBudgetCash()]);
  return <BudgetView data={data} position={position} cash={cash} />;
}
