import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundDetails } from "./not-found-details";

export const metadata: Metadata = { title: "Page not found" };

// A missing-texture tile, the checkerboard games draw when an asset is gone.
// It stands in for the 0 so the error reads as "this tile is missing".
function MissingTile() {
  const cells = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      if ((x + y) % 2 === 0) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  }
  return (
    <svg
      viewBox="0 0 6 6"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="not-found-tile h-[0.8em] w-[0.8em] border-[3px] border-stroke bg-panel fill-accent shadow-drop"
    >
      {cells}
    </svg>
  );
}

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-panel-deep px-4 py-12 text-ink">
      <section className="w-full max-w-xl border-[3px] border-stroke bg-panel p-6 shadow-drop-lg sm:p-10">
        <p
          role="img"
          aria-label="404"
          className="flex items-center gap-[0.12em] font-pixel text-[7rem] leading-none sm:text-[9rem]"
        >
          <span aria-hidden="true">4</span>
          <MissingTile />
          <span aria-hidden="true">4</span>
        </p>

        <h1 className="mt-8 font-pixel text-3xl font-semibold sm:text-4xl">That tile isn&apos;t on the map</h1>
        <NotFoundDetails />

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="border-[3px] border-stroke bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-drop hover:text-white transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Go to Pixl
          </Link>
          <Link
            href="/dashboard"
            className="border-[3px] border-stroke bg-panel-2 px-5 py-2.5 text-sm font-semibold text-ink shadow-drop hover:text-ink transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Open your dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
