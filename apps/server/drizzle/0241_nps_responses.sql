-- NPS survey responses. One row per player per wave, so a player can be asked
-- again later (a new wave) without overwriting an earlier answer.
-- The survey is gated by NPS_MODE on the server (off | preview | live); while it
-- is in preview only the Slack IDs in NPS_PREVIEW_SLACK_IDS can see or answer it.
CREATE TABLE IF NOT EXISTS nps_responses (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave        text NOT NULL,
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 10),
  reason      text NOT NULL DEFAULT '',
  -- Optional 1..5 ratings per area, e.g. {"onboarding":4,"reviews":2}.
  ratings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  fix_text    text NOT NULL DEFAULT '',
  -- The player agreed to be DMed about their answer.
  contact_ok  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, wave)
);

CREATE INDEX IF NOT EXISTS nps_responses_wave_idx ON nps_responses (wave, created_at DESC);
