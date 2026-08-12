-- Categories for the Qulay Cafe menu (Birinchi taom, Ikkinchi taom, ...).
-- Multilingual labels mirror the customer-facing language switcher (uz/ru/en).

CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name_uz     VARCHAR(120) NOT NULL,
    name_ru     VARCHAR(120) NOT NULL,
    name_en     VARCHAR(120) NOT NULL,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS categories_sort_order_idx
    ON categories (sort_order, id);

CREATE INDEX IF NOT EXISTS categories_is_active_idx
    ON categories (is_active);

-- Seed the two categories you already have. Safe to re-run: each row is
-- inserted only when no category with the same Uzbek name exists yet.
INSERT INTO categories (name_uz, name_ru, name_en, sort_order)
SELECT seed.name_uz, seed.name_ru, seed.name_en, seed.sort_order
  FROM (
        VALUES
            ('Birinchi taom', 'Первое блюдо',  'First course',  0),
            ('Ikkinchi taom', 'Второе блюдо',  'Second course', 1)
       ) AS seed (name_uz, name_ru, name_en, sort_order)
 WHERE NOT EXISTS (
           SELECT 1
             FROM categories c
            WHERE c.name_uz = seed.name_uz
       );
