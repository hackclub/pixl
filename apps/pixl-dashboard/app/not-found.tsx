import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundDetails } from "./not-found-details";
import styles from "./not-found.module.css";

export const metadata: Metadata = { title: "Page not found" };

// Keep the same missing-texture symbol as the previous Pixl 404 page.
function MissingTile() {
  const squares = Array.from({ length: 36 }, (_, index) => ({
    x: index % 6,
    y: Math.floor(index / 6),
  })).filter(({ x, y }) => (x + y) % 2 === 0);

  return (
    <span className={styles.missingTile} aria-hidden="true">
      <svg viewBox="0 0 6 6" shapeRendering="crispEdges" focusable="false">
        {squares.map(({ x, y }) => (
          <rect key={x + y * 6} x={x} y={y} width="1" height="1" />
        ))}
      </svg>
    </span>
  );
}

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.gameWindow} aria-label="Page not found">
        <header className={styles.windowBar}>
          <span className={styles.wordmark}>Pixl</span>
          <span className={styles.windowStatus}>404 / LOST TILE</span>
        </header>

        <div className={styles.world}>
          {/* Actual village map from apps/game/assets/map/village.png. */}
          <div className={styles.mapLabel}>WORLD 01 / UNKNOWN TILE</div>
          <div className={styles.errorLabel}>OUT OF BOUNDS</div>

          <MissingTile />
          <div className={styles.worldPixo} aria-hidden="true">
            <span className={styles.worldSprite} />
            <span className={styles.questionEmote} />
          </div>

          <div className={styles.dialogue}>
            <span className={styles.speaker}>PIXO</span>
            <div className={styles.portrait} aria-hidden="true">
              <span className={styles.portraitSprite} />
            </div>
            <div className={styles.dialogueCopy}>
              <h1>yo, you got lost or sm?</h1>
              <p>That tile isn&apos;t on the map. Wanna head back?</p>
            </div>
            <nav className={styles.actions} aria-label="Find your way back">
              <Link href="/" className={styles.primaryAction}>
                Back to Pixl
              </Link>
              <Link href="/dashboard" className={styles.secondaryAction}>
                Open dashboard
              </Link>
            </nav>
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.coords}>X: ??? &nbsp; Y: ???</span>
          <NotFoundDetails />
        </footer>
      </section>
    </main>
  );
}
