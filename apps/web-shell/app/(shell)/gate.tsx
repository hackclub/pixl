"use client";

import { useEffect, useState } from "react";

/**
 * Signed-out gate. Used to offer only "Enter the Game", which meant the only
 * way into any shell page was to load the Godot client and have it hand a
 * token over. The old static shell had a LOG IN button for exactly this
 * (pixl.js mountTopbar) and the React port dropped it, so this puts direct
 * login back.
 */
export function Gate({
  game,
  loginBase,
  fallbackBack,
}: {
  game: string;
  /** `${server}/auth/hackclub?web_redirect=` , the target gets appended. */
  loginBase: string;
  /** Best-effort current URL from the server, replaced once we're in the
   * browser: the server only sees an internal hop and a proxy header, while
   * location.href is the real thing including whatever query the game
   * appended (?embed=1 and friends). */
  fallbackBack: string;
}) {
  const [back, setBack] = useState(fallbackBack);
  useEffect(() => setBack(window.location.href), []);

  return (
    <div className="gate">
      <div className="gate-card">
        <img className="gate-splash" src="/img/boot-splash.png" alt="Pixl" />
        <p>
          This page is part of the Pixl world. Log in with Hack Club to use it right here, or hop
          into the game and walk up to the shop or an NPC.
        </p>
        <div className="gate-actions">
          <a className="btn-enter" href={loginBase + encodeURIComponent(back)}>
            Log In
          </a>
          <a className="btn-enter ghost" href={game}>
            Enter the Game
          </a>
        </div>
      </div>
    </div>
  );
}
