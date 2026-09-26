import { headers } from "next/headers";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { currentUrl, gameUrl, loginUrl } from "@/lib/urls";
import { Gate } from "./gate";
import { ShellNav } from "./shell-nav";

interface Wallet {
  pixels: number;
  re: number;
}
interface EventsActive {
  community_re: number;
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
    return <Gate loginBase={loginUrl("")} fallbackBack={back} />;
  }

  const [wallet, events] = await Promise.all([
    serverApi<Wallet>("/api/profile/wallet"),
    serverApi<EventsActive>("/api/events/active"),
  ]);
  const pixels = wallet ? Math.round(wallet.pixels) : 0;
  const re = wallet ? Math.round(wallet.re) : 0;
  const communityRe = events ? Math.round(events.community_re) : 0;

  return (
    <>
      <ShellNav game={game} pixels={pixels} re={re} communityRe={communityRe} />
      <div className="shell-main">
        <main className="wrap">{children}</main>
      </div>
    </>
  );
}
