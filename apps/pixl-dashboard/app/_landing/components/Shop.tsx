"use client";

import { motion } from "framer-motion";
import { useLocale } from "./LocaleProvider";
import { Marquee } from "./Marquee";
import { EndedLine } from "./StatsBand";

const ITEM_IMAGES = [
  "/shop/signed-photo.webp",
  "/shop/meme-pack.webp",
  "/shop/assets-grant.webp",
  "/shop/hc-stickers.webp",
  "/shop/api.webp",
  "/shop/music-grant.webp",
  "/shop/hardware-grant.webp",
  "/shop/domain-grant.webp",
  "/shop/hosting-grant.webp",
  "/shop/mystery-box.webp",
  "/shop/art-grant.webp",
  "/shop/cookie-cutter.webp",
  "/shop/soldering-iron.webp",
  "/shop/food-grant.webp",
  "/shop/pixel-composer.webp",
  "/shop/pico8.webp",
  "/shop/poster.webp",
  "/shop/aseprite.webp",
  "/shop/google-play.webp",
  "/shop/tamagotchi.webp",
  "/shop/indie-game.webp",
  "/shop/screwdriver.webp",
  "/shop/esp32.webp",
  "/shop/furycube.webp",
  "/shop/godot-plush.webp",
  "/shop/hoodie.webp",
  "/shop/blahaj.webp",
  "/shop/cpu-grant.webp",
  "/shop/gpu-grant.webp",
  "/shop/ram-grant.webp",
  "/shop/wacom.webp",
  "/shop/retro-handheld.webp",
  "/shop/keyboard-s75-pro.webp",
  "/shop/gamemaker.webp",
  "/shop/steam-license.webp",
  "/shop/apple-dev.webp",
  "/shop/monitor-4k.webp",
  "/shop/pencil-pro.webp",
  "/shop/rpi.webp",
  "/shop/sony-ch720n.webp",
  "/shop/ender3-v3.webp",
  "/shop/airpods-pro-3.webp",
  "/shop/a1-mini.webp",
  "/shop/samsung-t7-ssd.webp",
  "/shop/sony-headphones.webp",
  "/shop/sparkx-i7.webp",
  "/shop/bambu-a1.webp",
  "/shop/centauri-carbon.webp",
  "/shop/ipad.webp",
  "/shop/bambu-a1-combo.webp",
  "/shop/samsung-s24.webp",
  "/shop/airpods-max.webp",
  "/shop/nothing-phone.webp",
  "/shop/macbook-neo.webp",
  "/shop/ipad-air-m4.webp",
  "/shop/macbook-air.webp",
  "/shop/framework-13.webp",
  "/shop/framework-16.webp",
  "/shop/mac-mini.webp",
  "/shop/nintendo-switch-2.webp",
];

// Fixed per position rather than random, so the server and the client agree on
// every angle and the row doesn't reshuffle on hydration.
const TILTS = [-5, 3, -2, 6, -4, 2, -6, 4];

function ShopItem({ item, index }: { item: { name: string }; index: number }) {
  const tilt = TILTS[index % TILTS.length];
  return (
    // Height drives the size and the width follows the image, so a keyboard is
    // wide and a plush is narrow instead of everything sitting in even columns.
    <div className="shrink-0 flex flex-col items-center gap-2 px-3 sm:px-4">
      <div className="h-44 sm:h-60 lg:h-72 flex items-end justify-center">
        <img
          src={ITEM_IMAGES[index]}
          alt={item.name}
          // Bounded on both axes. Height alone is not enough: a few items are
          // wordmarks or key art running 8:1, and those grew to thousands of
          // pixels wide before the width cap. The cap is twice the height cap,
          // which is what lets a 2.8:1 item like the cookie cutter still come
          // out a decent size, while the real banners stay short and wide.
          className="max-h-full w-auto max-w-[22rem] sm:max-w-[30rem] lg:max-w-[36rem] object-contain"
          style={{ transform: `rotate(${tilt}deg)` }}
          loading="lazy"
          draggable={false}
        />
      </div>
      <p
        className="font-pixel text-xs sm:text-sm text-center leading-snug text-black/70 max-w-36 sm:max-w-44"
        style={{ transform: `rotate(${tilt / 2}deg)` }}
      >
        {item.name}
      </p>
    </div>
  );
}

export function Shop() {
  const { dict } = useLocale();
  const t = dict.shop;

  return (
    <section className="my-10 md:my-20 px-4 md:px-8 flex flex-col items-center gap-16" id="shop">
      <div className="text-center">
        <motion.p
          className="text-sm font-bold uppercase tracking-widest text-black/50 mb-2 font-sans"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {t.badge}
        </motion.p>
        <motion.h2
          className="text-5xl md:text-6xl font-black"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {t.title}
        </motion.h2>
        <motion.p
          className="mt-3 text-black/60 text-base md:text-lg max-w-xl mx-auto font-sans"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {t.description}
        </motion.p>
        <EndedLine line="shopLine" />
      </div>

      <Marquee duration={75} className="pt-4 items-end">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {[...(t.items as any[]), ...(t.items as any[])].map((item: any, i: number) => (
          <ShopItem key={i} item={item} index={i % t.items.length} />
        ))}
      </Marquee>

      <motion.p
        className="inline-block font-pixel text-sm md:text-base bg-[#ff8c37] text-white px-5 py-3 border-2 border-black text-center"
        style={{ boxShadow: "4px 4px 0px #000" }}
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        {t.moreComing}
      </motion.p>
    </section>
  );
}
