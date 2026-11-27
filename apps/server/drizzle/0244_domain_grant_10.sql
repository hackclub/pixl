-- Domain Grant is a $10 grant. The original landing import said $12.
-- Safe to re-run; only touches copy that still has the old figure.
UPDATE shop_items
SET description = replace(description, '$12', '$10')
WHERE name = 'Domain Grant' AND description LIKE '%$12%';
