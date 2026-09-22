"use client";

import { useEffect, useState } from "react";

/**
 * Signed-out gate. Only action offered is Log In - the old static shell's
 * LOG IN button (pixl.js mountTopbar), which the React port dropped and this
 * puts back.
 */
export function Gate({
  loginBase,
  fallbackBack,
}: {
  /** `/api/login?back=` , the target gets appended. */
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
        <p>This page is part of the Pixl world. Log in with Hack Club to use it right here.</p>
        <div className="gate-actions">
          <a className="btn-enter" href={loginBase + encodeURIComponent(back)}>
            Log In
          </a>
        </div>
      </div>
    </div>
  );
}
