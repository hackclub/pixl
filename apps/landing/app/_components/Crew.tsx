"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";

// The people behind Pixl. Add each person's profile URL to `link` to make their
// name clickable.
type Person = { name: string; link: string };
const ORGS: Person[] = [
  { name: "Ridit", link: "https://hackclub.enterprise.slack.com/team/U0ARC79GEAV" },
  { name: "Gabin", link: "https://hackclub.enterprise.slack.com/team/U0A2SJ7B739" },
  { name: "Ricky", link: "https://hackclub.enterprise.slack.com/team/U0A1VPETCR3" },
];
const SPONSORS: Person[] = [
  { name: "barnav", link: "https://hackclub.enterprise.slack.com/team/U08RVF1BAN4" },
  { name: "seba", link: "" },
];

function Name({ p }: { p: Person }) {
  const cls = "font-bold text-white hover:text-[#ff8c37] underline-offset-2 hover:underline transition-colors";
  return p.link ? (
    <a href={p.link} target="_blank" rel="noopener noreferrer" className={cls}>
      {p.name}
    </a>
  ) : (
    <span className="font-bold text-white">{p.name}</span>
  );
}

/** Renders "A, B & C" with each name clickable. */
function NameList({ people }: { people: Person[] }) {
  return (
    <>
      {people.map((p, i) => (
        <Fragment key={p.name}>
          {i > 0 && <span>{i === people.length - 1 ? " & " : ", "}</span>}
          <Name p={p} />
        </Fragment>
      ))}
    </>
  );
}

/** Two simple credit lines, shown under the hero CTA (no background). */
export function Crew() {
  return (
    <motion.div
      className="mt-4 text-center font-sans italic text-sm sm:text-base text-white/85"
      style={{ textShadow: "0 2px 6px rgba(0,0,0,0.75)" }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 1 }}
    >
      <p>
        made by <NameList people={ORGS} />
      </p>
      <p>
        Sponsored by <NameList people={SPONSORS} />
      </p>
    </motion.div>
  );
}
