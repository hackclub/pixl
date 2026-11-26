"use server";

import { z } from "zod";
import { guardedAction, json } from "@/lib/guarded-action";

const rating = z.number().int().min(1).max(5).optional();

export const submitNps = guardedAction(
  "nps.answer",
  z.object({
    score: z.number().int().min(0).max(10),
    reason: z.string().trim().max(1000).optional(),
    ratings: z
      .object({ onboarding: rating, reviews: rating, shop: rating, communication: rating })
      .optional(),
    fixText: z.string().trim().max(500).optional(),
    contactOk: z.boolean().optional(),
  }),
  (input) => ({ method: "POST", path: "/api/nps", body: json(input), target: "nps" }),
  { revalidate: ["/nps"], pick: () => null },
);
