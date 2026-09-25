"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Split out as a Client Component only for the window.print() call - the
// label itself (page.tsx) stays a Server Component that does the data
// fetching. Wrapped in .no-print so it never shows up in the actual
// printout, just on screen.
export function PrintButton() {
  return (
    <div className="no-print flex items-center gap-3 p-4">
      <Button onClick={() => window.print()}>Print label</Button>
      <Link href="/fulfillment" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to fulfillment
      </Link>
    </div>
  );
}
