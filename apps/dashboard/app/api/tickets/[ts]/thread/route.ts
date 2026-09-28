import { NextRequest, NextResponse } from "next/server";
import { getHelperAccess } from "@/lib/guard";
import { isMissingThread, ticketThread } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ts: string }> },
) {
  const access = await getHelperAccess();
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { ts } = await params;
  try {
    const messages = await ticketThread(ts);
    return NextResponse.json({ messages });
  } catch (e) {
    if (isMissingThread(e)) {
      return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
