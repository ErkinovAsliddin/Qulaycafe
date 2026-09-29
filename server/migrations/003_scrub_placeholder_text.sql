-- Remove government/placeholder boilerplate from category and dish names, so it
-- can never be rendered in the menu again.
--
-- DRY RUN BY DEFAULT: it reports every match and writes nothing until
-- `scrub.apply` is set to 'on' for the session.
--
--   # 1. back up first — an UPDATE is not undoable
--   pg_dump "$DATABASE_URL" -Fc -f before-scrub.dump
--
--   # 2. dry run (read-only — safe to run anywhere)
--   psql "$DATABASE_URL" -f server/migrations/003_scrub_placeholder_text.sql
--
--   # 3. apply, with the switch set in the same session
--   psql "$DATABASE_URL" -c "SET scrub.apply = 'on'" \
--                        -f server/migrations/003_scrub_placeholder_text.sql
--
--   # 4. verify — re-run step 2, it should report zero matches
--
-- WHY A DO BLOCK RATHER THAN PLAIN SQL: the `dishes` table is created outside
-- this migrations folder — routes/categories.js even warns "adjust if your
-- dishes table or its foreign key column is named differently" — so its columns
-- cannot be known from here. Hard-coding a column that may not exist would abort
-- the migration part-way. This resolves the real columns from information_schema
-- and skips whatever is absent.
--
-- Confirm the columns yourself if the report looks wrong:
--
--   SELECT table_name, column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name IN ('categories','dishes')
--    ORDER BY table_name, ordinal_position;
--
-- `id` is assumed as the primary key on both tables: migration 001 creates
-- categories that way, and routes/categories.js joins on d.id for dishes.
-- A table without `id` is reported and skipped rather than broken.

BEGIN;

DO $$
DECLARE
  -- Marker for a name that was nothing but boilerplate. Rename these rows via
  -- the admin UI; the value is only here to keep the column valid and unique.
  fallback_label constant text := 'Nomsiz';

  -- Uzbek/Russian ministry, cabinet, bank and report wording, matched with its
  -- grammatical suffixes so "vazirligining" / "bankning" disappear whole rather
  -- than leaving "ning" behind. [[:space:]] accepts any whitespace.
  -- The apostrophe in "to'g'risida" is accepted either straight or curly, since
  -- the text may have been pasted from a document.
  pattern constant text :=
    '(moliya[[:space:]]+vazirlig|vazirlik|vazirlar|mahkama|hukumat|'
    'markaziy[[:space:]]+bank|to[''’]g[''’]risida[[:space:]]+axborot)';

  apply boolean := coalesce(current_setting('scrub.apply', true), 'off') = 'on';
  col record;
  example text;
  matched integer;
  changed integer;
  total integer := 0;
BEGIN
  RAISE NOTICE '=== % ===', CASE WHEN apply THEN 'APPLY' ELSE 'DRY RUN — nothing is written' END;

  FOR col IN
    SELECT v.tbl, v.col
      FROM (VALUES
              ('categories', 'name_uz'),
              ('categories', 'name_ru'),
              ('categories', 'name_en'),
              ('dishes', 'name'),
              ('dishes', 'name_uz'),
              ('dishes', 'name_ru'),
              ('dishes', 'name_en'),
              ('dishes', 'title')
           ) AS v(tbl, col)
     WHERE EXISTS (
             SELECT 1
               FROM information_schema.columns ic
              WHERE ic.table_schema = ANY (current_schemas(false))
                AND ic.table_name = v.tbl
                AND ic.column_name = v.col
           )
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I ~* $1', col.tbl, col.col)
       INTO matched USING pattern;

    IF matched = 0 THEN
      CONTINUE;
    END IF;

    total := total + matched;
    RAISE NOTICE '%.%  —  % matching row(s)', col.tbl, col.col, matched;

    IF NOT apply THEN
      FOR example IN EXECUTE format(
            'SELECT DISTINCT %I FROM %I WHERE %I ~* $1 ORDER BY 1 LIMIT 5',
            col.tbl, col.col, col.col)
            USING pattern
      LOOP
        RAISE NOTICE '    would be replaced: %', example;
      END LOOP;
      RAISE NOTICE '    → becomes "% <id>"', fallback_label;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
         SELECT 1
           FROM information_schema.columns ic
          WHERE ic.table_schema = ANY (current_schemas(false))
            AND ic.table_name = col.tbl
            AND ic.column_name = 'id'
       )
    THEN
      RAISE NOTICE '    skipped: % has no id column to build a fallback name from', col.tbl;
      CONTINUE;
    END IF;

    -- Every target column of this migration is a NAME, so the value is replaced
    -- wholesale rather than scrubbed in place. Deleting only the offending
    -- phrase looked tempting but leaves debris: removing "Moliya vazirligi"
    -- from "O'zbekiston Respublikasi Moliya vazirligi" yields "O'zbekiston
    -- Respublikasi" — no ministry wording, and still not a menu category. The
    -- same rule is used by scripts/purge-placeholder-text.js, so both tools
    -- produce the same result.
    --
    -- The replacement is the marker joined to the row's id. A name column is
    -- NOT NULL, and categories additionally carry the unique index on
    -- lower(name_uz) from migration 002 — a bare marker would violate the first
    -- and collide across rows under the second. With the id appended the value
    -- is present and unique, and visibly names a row a human still has to fix.
    EXECUTE format($fmt$
      UPDATE %1$I
         SET %2$I = %3$L || ' ' || id
       WHERE %2$I ~* $1
    $fmt$, col.tbl, col.col, fallback_label)
      USING pattern;

    GET DIAGNOSTICS changed = ROW_COUNT;
    RAISE NOTICE '    updated % row(s)', changed;
  END LOOP;

  IF apply THEN
    RAISE NOTICE 'Apply complete. Rows renamed to "% …" need real names from the admin UI.', fallback_label;
  ELSIF total > 0 THEN
    RAISE NOTICE 'DRY RUN: % value(s) would change. Nothing was written.', total;
    RAISE NOTICE 'To apply, re-run with:  -c "SET scrub.apply = ''on''"';
  ELSE
    RAISE NOTICE 'Clean: no matching value in categories or dishes.';
  END IF;
END
$$;

COMMIT;
