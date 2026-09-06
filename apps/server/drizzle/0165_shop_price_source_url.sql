-- Per-row (i.e. per-region, since shop_items is one row per region) link to
-- wherever an admin sourced that price from - a retailer product page, a
-- regional storefront, etc - so regional pricing (Europe and otherwise) can
-- be audited and re-checked against the real listing instead of guessed at.
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS price_source_url text NOT NULL DEFAULT '';
