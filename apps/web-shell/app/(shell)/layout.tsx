import { headers } from "next/headers";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { currentUrl, gameUrl, loginUrl } from "@/lib/urls";
import { config } from "@/app/_generated/config";
import { Gate } from "./gate";
import { ShellNav } from "./shell-nav";

interface Wallet {
  pixels: number;
}
interface ActiveEvent {
  type: string;
  target: number;
  progress: number;
}
interface EventsActive {
  events: ActiveEvent[];
}

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const h = await headers();
  const host = h.get("host") ?? "";
  const game = gameUrl(host);

  if (!session) {
    // proxy.ts forwards the path it saw; without it the server would have to
    // guess, and a login that comes back to the wrong page is worse than no
    // login button at all. The client corrects this on mount either way.
    const back = currentUrl(host, h.get("x-pixl-path") ?? "/");
    return <Gate game={game} loginBase={loginUrl(config.urls.server, "")} fallbackBack={back} />;
  }

  const [wallet, events] = await Promise.all([
    serverApi<Wallet>("/api/profile/wallet"),
    serverApi<EventsActive>("/api/events/active"),
  ]);
  const pixels = wallet ? Math.round(wallet.pixels) : 0;
  const restoration = (events?.events ?? []).find((e) => e.type === "community_goal" && Number(e.target) > 0);
  const restorationPct = restoration
    ? Math.max(0, Math.min(100, Math.round((restoration.progress / restoration.target) * 100)))
    : null;

  return (
    <>
      <ShellNav game={game} pixels={pixels} restorationPct={restorationPct} />
      <div className="shell-main">
        <main className="wrap">{children}</main>
      </div>
    </>
  );
}
