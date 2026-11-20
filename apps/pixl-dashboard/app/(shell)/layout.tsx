import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { wrap } from "@/components/ui/primitives";
import { serverApi, serverGet } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { expiredUrl, sessionRejected } from "@/lib/session-expiry";
import { GAME_URL } from "@/lib/urls";
import { config, formatDate, submissionDeadline } from "@/app/_generated/config";
import { DeadlineBanner } from "./deadline-banner";
import { Gate } from "./gate";
import { PhantomBanner } from "./phantom-banner";
import { ShellNav } from "./shell-nav";

interface Wallet {
  pixels: number;
  re: number;
}
interface EventsActive {
  community_re: number;
}

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Verified locally against JWT_SECRET on every request.
  const session = await getSession();

  // proxy.ts forwards the requested path so the no-JS login link returns to
  // the same page; safeNext() re-checks it server side.
  const here = async () => (await headers()).get("x-pixl-path") ?? "/dashboard";

  if (!session) return <Gate next={await here()} />;

  const [walletRes, events] = await Promise.all([
    serverGet<Wallet>("/api/profile/wallet"),
    serverApi<EventsActive>("/api/events/active"),
  ]);
  // The JWT still verifies locally but apps/server has revoked it (or banned
  // the player): treat it as signed out. A layout can't clear cookies, so
  // /api/auth/expired does, re-checks with the server, then comes back here
  // to render the Gate.
  if (!walletRes.ok && sessionRejected(walletRes.status, walletRes.error)) redirect(expiredUrl(await here()));
  const wallet = walletRes.ok ? walletRes.data : null;

  return (
    <>
      <ShellNav
        game={GAME_URL}
        displayName={session.displayName}
        pixels={wallet ? Math.round(wallet.pixels) : 0}
        re={wallet ? Math.round(wallet.re) : 0}
        communityRe={events ? Math.round(events.community_re) : 0}
      />
      {/* Clears the fixed sidebar and top rail (a bottom dock under 900px). */}
      <div className="pt-[54px] pl-(--sidebar) max-[900px]:pb-[64px] max-[900px]:pl-0">
        <div className="px-[20px]">
          <DeadlineBanner deadline={config.submissionDeadline} label={formatDate(submissionDeadline)} />
          <PhantomBanner />
        </div>
        <main className={wrap}>{children}</main>
      </div>
    </>
  );
}
