-- Stop duplicate menu categories.
--
-- 001 has already run on existing databases, so the constraint lives in its
-- own migration instead of being edited into that file.
--
-- The index is case-insensitive: "Somsa" and "somsa" are the same section to a
-- customer, so the admin form should reject the second one. Names are trimmed
-- by the API before they reach here.
--
-- CREATE UNIQUE INDEX fails if duplicates already exist. Run this first and
-- merge or rename anything it reports before applying the migration:
--
--   SELECT lower(name_uz) AS name, COUNT(*), array_agg(id ORDER BY id) AS ids
--     FROM categories
--    GROUP BY lower(name_uz)
--   HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uz_lower_key
    ON categories (lower(name_uz));
