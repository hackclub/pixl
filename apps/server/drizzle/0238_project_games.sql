-- A game is a project category, not a runtime/platform or review track.
-- Keep project_type and kind untouched, including older misclassified types.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_game boolean NOT NULL DEFAULT false;

-- Curated from shipped projects' descriptions as of 2026-11-04.
-- Mixed/game-related tools are intentionally excluded pending human review.
UPDATE public.projects
SET is_game = true
WHERE id IN (871, 880, 1600, 1614, 1628, 1851, 1863, 1897, 1912, 1926, 1927, 1983, 1997, 2112, 2113, 2133, 2138, 2191, 2245, 2254, 2276, 2332, 2333)
  AND is_game = false;
