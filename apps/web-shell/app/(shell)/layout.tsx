import { headers } from "next/headers";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { gameUrl } from "@/lib/urls";
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
  const host = (await headers()).get("host") ?? "";
  const game = gameUrl(host);

  if (!session) {
    return (
      <div className="gate">
        <div className="gate-card">
          <img className="gate-splash" src="/img/boot-splash.png" alt="Pixl" />
          <p>
            This page is part of the Pixl world. Hop into the game and walk up to the shop, an NPC, or
            press the shortcut key to open it with your account.
          </p>
          <a className="btn-enter" href={game}>
            Enter the Game
          </a>
        </div>
      </div>
    );
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
