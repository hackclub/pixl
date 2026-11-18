"use client";
import { motion } from "framer-motion";
import { useLocale } from "./LocaleProvider";

const container = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.07,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

export function Footer() {
  const { dict } = useLocale();
  const t = dict.footer;

  return (
    <footer className="bg-white border-t-4 border-black px-4 md:px-20 py-6 md:py-10 mt-10 md:mt-30">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="mb-8"
      >
        <p className="text-xl font-black mb-4">
          {t.aProjectBy}{" "}
          <a
            target="_blank"
            className="text-[#ec3750] underline underline-offset-4 hover:text-[#ff8c37] transition-colors"
          >
            {t.teens}
          </a>
        </p>
        <p className="max-w-2xl text-black/70 leading-relaxed">
          {t.hackClubDesc1}{" "}
          <a
            href="https://summer.hackclub.com"
            target="_blank"
            className="text-inherit underline underline-offset-2 hover:text-[#ec3750] transition-colors"
          >
            {t.partneredWithGithub}
          </a>
          ,{" "}
          <a
            href="https://www.youtube.com/watch?v=nf0S5qGrFyY"
            target="_blank"
            className="text-inherit underline underline-offset-2 hover:text-[#ec3750] transition-colors"
          >
            {t.hostedWorldsLongest}
          </a>
          , {t.and}{" "}
          <a
            href="https://losangeles.hackclub.com"
            target="_blank"
            className="text-inherit underline underline-offset-2 hover:text-[#ec3750] transition-colors"
          >
            {t.ranCanadasLargest}
          </a>
          .
        </p>
        <p className="mt-4 text-black/70">{t.hackClubMotto}</p>
        {/* Legal line, kept in English in every locale. */}
        <p className="mt-4 max-w-2xl text-sm text-black/60">
          YSWS - Pixl is fiscally sponsored by The Hack Foundation (d.b.a. Hack Club), a 501(c)(3) nonprofit (EIN:
          81-2908499).
        </p>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-8 border-t-2 border-black pt-8"
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true }}
      >
        <div>
          <motion.p
            variants={item}
            className="font-black text-[#ff8c37] text-lg mb-4"
          >
            {t.pixl}
          </motion.p>
          {[
            { label: t.whatIsPixl, href: "#what" },
            { label: t.howItWorks, href: "#story" },
            { label: t.faq, href: "#faq" },
            { label: t.docs, href: "/docs" },
          ].map(({ label, href }) => (
            <motion.a
              key={label}
              variants={item}
              href={href}
              className="block text-black/70 hover:text-[#ec3750] transition-colors mb-2 w-fit"
            >
              {label}
            </motion.a>
          ))}
        </div>

        <div>
          <motion.p
            variants={item}
            className="font-black text-[#ec3750] text-lg mb-4"
          >
            {t.resources}
          </motion.p>
          {[
            { label: t.joinOurSlack, href: "https://slack.hackclub.com" },
            { label: t.communityEvents, href: "https://events.hackclub.com/" },
            { label: t.workshops, href: "https://workshops.hackclub.com/" },
            { label: t.codeOfConduct, href: "https://hackclub.com/conduct/" },
          ].map(({ label, href }) => (
            <motion.a
              key={label}
              variants={item}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block text-black/70 hover:text-[#ec3750] transition-colors mb-2 w-fit"
            >
              {label}
            </motion.a>
          ))}
        </div>

        <div>
          <motion.p
            variants={item}
            className="font-black text-[#ec3750] text-lg mb-4"
          >
            {t.hackClub}
          </motion.p>
          {[
            { label: t.philosophy, href: "https://hackclub.com/philosophy/" },
            { label: t.ourTeamAndBoard, href: "https://hackclub.com/team/" },
            { label: t.branding, href: "https://hackclub.com/brand/" },
            { label: t.donate, href: "https://hackclub.com/philanthropy/" },
          ].map(({ label, href }) => (
            <motion.a
              key={label}
              variants={item}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block text-black/70 hover:text-[#ec3750] transition-colors mb-2 w-fit"
            >
              {label}
            </motion.a>
          ))}
        </div>
      </motion.div>

      <motion.div
        className="mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-black/40 text-sm border-t-2 border-black/10 pt-6"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        <p className="min-w-0">{t.madeWithLove}</p>
        <p className="min-w-0 text-right">
          {t.addSomething}{" "}
          <a
            href="https://github.com/Pixl-YSWS/pixl"
            target="_blank"
            rel="noreferrer"
            className="text-inherit underline underline-offset-2 hover:text-[#ec3750] transition-colors"
          >
            {t.github}
          </a>
          .
        </p>
      </motion.div>
    </footer>
  );
}
