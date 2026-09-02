export const GABIN_ID = "U0A2SJ7B739";
export const RIDIT_ID = "U0ARC79GEAV";
export const RICKY_ID = "U0A1VPETCR3";

/** #pixl - the main public channel, the one every "come join us" link points at. */
export const PIXL_MAIN_CHANNEL = "C0B5P4N0WHH";

/** Channels Pixo is allowed to be chatty in. */
export const PIXL_CHANNELS = [PIXL_MAIN_CHANNEL, "C0B5UEMF4RW"];

export const PIXL_PROMO = `\n\n_Join <#${PIXL_MAIN_CHANNEL}> to discover more Pixl commands!_`;

export const TRAINING_CHANNEL = "C0BD7JSTQNM";

/**
 * Channels Pixo must never speak in, not even a mention, chime-in, or
 * easter egg. Checked first thing in the message handler, before anything
 * else runs. These are other people's channels, not Pixl's.
 */
export const SILENCED_CHANNELS = new Set([
  "C0AUZ1LAMH6",
  "C0AUZ1P2DEC",
  "C0AU8AWD5BN",
  "C0AUZ1X5QAU",
]);
