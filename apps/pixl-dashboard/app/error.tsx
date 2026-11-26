"use client";

import { useEffect } from "react";

// A tab may submit a Server Action from the build that was active before a
// deployment. Reload once to fetch the matching action IDs and assets.
const STALE_DEPLOY = /failed to find server action|was not found on the server|older or newer deployment/i;
const RELOAD_FLAG = "pixl:stale-deploy-reload";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const staleDeploy = STALE_DEPLOY.test(error.message);

  useEffect(() => {
    if (!staleDeploy) {
      console.error(error);
      return;
    }

    const key = `${RELOAD_FLAG}:${location.pathname}`;
    try {
      const lastReload = Number(sessionStorage.getItem(key));
      if (Number.isFinite(lastReload) && Date.now() - lastReload < 10_000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage may be blocked; still make one best-effort reload.
    }
    window.location.reload();
  }, [error, staleDeploy]);

  return (
    <main className="mx-auto max-w-lg px-6 py-20 text-center">
      <h2 className="text-xl font-semibold">{staleDeploy ? "Pixl was updated" : "Something went wrong"}</h2>
      <p className="mt-3 text-sm text-faint">
        {staleDeploy
          ? "This tab had an old version open. Refresh the page, then repeat your last action."
          : "Try the page again. If it keeps failing, refresh Pixl and retry."}
      </p>
      <button
        className="mt-6 rounded-md border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
        onClick={() => reset()}
      >
        Try again
      </button>
    </main>
  );
}
