"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GUIDELINE_PAGES } from "@/lib/guidelinesContent";
import { MIN_SECONDS_PER_PAGE, GUIDELINES_LIVE_URL } from "@/lib/guidelines";
import { acknowledgeGuidelines, skipGuidelines } from "@/app/actions";

// Average silent-reading speed, used to size each page's timer to its actual
// length instead of charging every page the same MIN_SECONDS_PER_PAGE - a
// one-paragraph page shouldn't take as long as the longest one.
const WORDS_PER_SECOND = 200 / 60;
// Never fully instant, even for a tiny page - there has to be *some* pause.
const MIN_READ_SECONDS = 6;

// First-time reviewer gate: step through every guideline page in order, spend
// at least a page-sized minimum on each, scaled by word count and capped at
// MIN_SECONDS_PER_PAGE (a page auto-marks "read" once its timer elapses), then
// confirm on the final recap page. The confirm is a form calling the
// acknowledgeGuidelines server action, which records the ack and drops the
// reviewer into the queue.
export function GuidelinesGate() {
  const pages = GUIDELINE_PAGES;
  const [i, setI] = useState(0);
  const [read, setRead] = useState<boolean[]>(() => pages.map(() => false));
  const [openedAt, setOpenedAt] = useState<(number | null)[]>(() =>
    pages.map((_, j) => (j === 0 ? Date.now() : null)),
  );
  const [pageSeconds, setPageSeconds] = useState<(number | null)[]>(() =>
    pages.map(() => null),
  );
  const [now, setNow] = useState(() => Date.now());
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Start a page's timer the first time it's shown, and size it from the
  // page's own rendered text (already on screen by the time this effect
  // runs, since it commits after the render that picked page `i`).
  useEffect(() => {
    setOpenedAt((prev) =>
      prev[i] == null ? prev.map((v, j) => (j === i ? Date.now() : v)) : prev,
    );
    setPageSeconds((prev) => {
      if (prev[i] != null) return prev;
      const words = (contentRef.current?.textContent ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      const estimated = Math.ceil(words / WORDS_PER_SECOND);
      const secs = Math.min(MIN_SECONDS_PER_PAGE, Math.max(MIN_READ_SECONDS, estimated));
      return prev.map((v, j) => (j === i ? secs : v));
    });
  }, [i]);

  const at = openedAt[i];
  const duration = pageSeconds[i] ?? MIN_SECONDS_PER_PAGE;
  const remaining = at == null ? duration : Math.max(0, duration - Math.floor((now - at) / 1000));

  // Once the current page's minimum time elapses, mark it read.
  useEffect(() => {
    if (remaining === 0 && !read[i]) {
      setRead((r) => r.map((v, j) => (j === i ? true : v)));
    }
  }, [remaining, i, read]);

  const isLast = i === pages.length - 1;
  const allRead = read.every(Boolean);
  const readCount = read.filter(Boolean).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Before you review</h1>
        <p className="text-muted-foreground text-sm">
          Reviewing decides whether real people get paid. Everyone reads the YSWS
          Project Submission Guidelines once before joining the queue, step
          through every page, spending at least a few seconds on each (shorter
          pages take less time, up to {MIN_SECONDS_PER_PAGE}s for the longest).
          This only happens the first time (and again if the guidelines change).
        </p>
        <p className="text-muted-foreground text-xs">
          This is a snapshot for convenience. The official, always-current
          version lives here:{" "}
          <a
            className="underline"
            href={GUIDELINES_LIVE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            hackclub.gitbook.io/ysws-project-submission-guidelines
          </a>
        </p>
      </div>

      {/* progress */}
      <div className="flex items-center gap-3">
        <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${(readCount / pages.length) * 100}%` }}
          />
        </div>
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {readCount} / {pages.length} read
        </span>
      </div>

      <Card className="p-5">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Page {i + 1} of {pages.length}
        </div>
        <h2 className="mb-3 text-lg font-semibold">{pages[i].title}</h2>
        <div ref={contentRef} className="max-h-[55vh] overflow-y-auto pr-1">
          {pages[i].body}
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={i === 0}
            onClick={() => setI((v) => Math.max(0, v - 1))}
          >
            ← Back
          </Button>
          <form action={skipGuidelines}>
            <Button
              type="submit"
              variant="ghost"
              className="text-muted-foreground"
              title="Skips the read-through. The team gets a heads-up in Slack."
            >
              Skip for now
            </Button>
          </form>
        </div>

        {!isLast ? (
          <Button
            type="button"
            disabled={remaining > 0}
            onClick={() => setI((v) => Math.min(pages.length - 1, v + 1))}
          >
            {remaining > 0 ? `Keep reading… ${remaining}s` : "Next →"}
          </Button>
        ) : (
          <form action={acknowledgeGuidelines}>
            <Button type="submit" disabled={!allRead || remaining > 0}>
              {remaining > 0
                ? `Keep reading… ${remaining}s`
                : allRead
                  ? "I've read all the guidelines - enter review"
                  : "Read every page to continue"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
