'use strict';

const express = require('express');

/** Postgres unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Categories router factory.
 *
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool - Postgres pool.
 * @param {Function} deps.requireAdmin - Express middleware that rejects
 *   non-admin requests. Required: write endpoints must never be public.
 * @returns {import('express').Router}
 */
function createCategoriesRouter({ pool, requireAdmin } = {}) {
  if (!pool) {
    throw new Error('createCategoriesRouter: `pool` is required.');
  }
  if (typeof requireAdmin !== 'function') {
    throw new Error(
      'createCategoriesRouter: `requireAdmin` middleware is required so that ' +
        'create/update/delete cannot be exposed publicly.'
    );
  }

  const router = express.Router();

  // Adjust if your dishes table or its foreign key column is named differently.
  const DISHES_TABLE = 'dishes';
  const DISHES_FK = 'category_id';

  const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

  const trimOrNull = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const wantsInactive = (req) =>
    req.query.includeInactive === '1' || req.query.includeInactive === 'true';

  /**
   * The category list is public because the customer-facing menu reads it,
   * but `includeInactive` exposes sections the admin deliberately switched
   * off. Gate the flag (not the whole route) behind requireAdmin so anonymous
   * callers can never enumerate hidden categories.
   */
  const requireAdminForInactive = (req, res, next) => {
    if (!wantsInactive(req)) return next();
    return requireAdmin(req, res, next);
  };

  /**
   * The unique index on lower(name_uz) (migration 002) is the only thing that
   * reliably stops duplicates under concurrency, so a violation is translated
   * into a 409 the admin UI can display instead of a generic 500.
   */
  const duplicateName = (res) => {
    const message = 'A category with this Uzbek name already exists.';
    return res.status(409).json({
      error: 'CATEGORY_NAME_TAKEN',
      errors: [message],
      message,
    });
  };

  /**
   * Validates a category payload. Returns { values, errors }.
   * Uzbek name is mandatory; Russian and English fall back to it when blank.
   *
   * `sortOrder` is null when the caller omitted the field. Callers are
   * expected to leave it out: create appends to the end and update keeps the
   * current position, both computed in SQL so concurrent admins cannot end up
   * with duplicate positions.
   *
   * `body` may be undefined (no JSON body sent, or express.json() not mounted),
   * so it is normalized before any property access.
   */
  function validate(body) {
    const src = body && typeof body === 'object' ? body : {};
    const errors = [];
    const nameUz = trimOrNull(src.name_uz);
    const nameRu = trimOrNull(src.name_ru);
    const nameEn = trimOrNull(src.name_en);

    if (!nameUz) {
      errors.push('name_uz is required.');
    } else if (nameUz.length > 120) {
      errors.push('name_uz must be 120 characters or fewer.');
    }
    if (nameRu && nameRu.length > 120) {
      errors.push('name_ru must be 120 characters or fewer.');
    }
    if (nameEn && nameEn.length > 120) {
      errors.push('name_en must be 120 characters or fewer.');
    }

    let sortOrder = null;
    if (src.sort_order !== undefined && src.sort_order !== null && src.sort_order !== '') {
      const parsed = Number(src.sort_order);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100000) {
        errors.push('sort_order must be an integer between 0 and 100000.');
      } else {
        sortOrder = parsed;
      }
    }

    const isActive = src.is_active === undefined ? true : Boolean(src.is_active);

    return {
      errors,
      values: {
        nameUz,
        nameRu: nameRu || nameUz,
        nameEn: nameEn || nameUz,
        sortOrder,
        isActive,
      },
    };
  }

  function parseId(raw) {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  // ---------------------------------------------------------------------------
  // Public read: used by the customer-facing menu. Anonymous callers see only
  // active categories; `includeInactive=1` requires an admin session.
  // ---------------------------------------------------------------------------
  router.get(
    '/',
    requireAdminForInactive,
    asyncRoute(async (req, res) => {
      const includeInactive = wantsInactive(req);

      const { rows } = await pool.query(
        `SELECT c.id,
                c.name_uz,
                c.name_ru,
                c.name_en,
                c.sort_order,
                c.is_active,
                COUNT(d.id)::int AS dish_count
           FROM categories c
           LEFT JOIN ${DISHES_TABLE} d ON d.${DISHES_FK} = c.id
          WHERE ($1::boolean OR c.is_active = TRUE)
          GROUP BY c.id
          ORDER BY c.sort_order ASC, c.id ASC`,
        [includeInactive]
      );

      res.json({ data: rows });
    })
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid category id.' });

      const { rows } = await pool.query(
        `SELECT id, name_uz, name_ru, name_en, sort_order, is_active
           FROM categories
          WHERE id = $1`,
        [id]
      );

      if (!rows.length) return res.status(404).json({ error: 'Category not found.' });
      res.json({ data: rows[0] });
    })
  );

  // ---------------------------------------------------------------------------
  // Admin writes.
  // ---------------------------------------------------------------------------
  router.post(
    '/',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const { errors, values } = validate(req.body);
      if (errors.length) return res.status(422).json({ errors });

      let rows;
      try {
        // When sort_order is omitted, append in the same statement so two
        // admins adding at the same time cannot claim the same position.
        ({ rows } = await pool.query(
          `INSERT INTO categories (name_uz, name_ru, name_en, sort_order, is_active)
           SELECT $1, $2, $3,
                  COALESCE(
                    $4::int,
                    (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM categories)
                  ),
                  $5
           RETURNING id, name_uz, name_ru, name_en, sort_order, is_active`,
          [values.nameUz, values.nameRu, values.nameEn, values.sortOrder, values.isActive]
        ));
      } catch (err) {
        if (err && err.code === UNIQUE_VIOLATION) return duplicateName(res);
        throw err;
      }

      res.status(201).json({ data: rows[0] });
    })
  );

  router.put(
    '/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid category id.' });

      const { errors, values } = validate(req.body);
      if (errors.length) return res.status(422).json({ errors });

      let rows;
      try {
        // An omitted sort_order keeps the stored position, so saving an edit
        // cannot silently undo a reorder made in the meantime.
        ({ rows } = await pool.query(
          `UPDATE categories
              SET name_uz    = $1,
                  name_ru    = $2,
                  name_en    = $3,
                  sort_order = COALESCE($4::int, sort_order),
                  is_active  = $5,
                  updated_at = NOW()
            WHERE id = $6
            RETURNING id, name_uz, name_ru, name_en, sort_order, is_active`,
          [values.nameUz, values.nameRu, values.nameEn, values.sortOrder, values.isActive, id]
        ));
      } catch (err) {
        if (err && err.code === UNIQUE_VIOLATION) return duplicateName(res);
        throw err;
      }

      if (!rows.length) return res.status(404).json({ error: 'Category not found.' });
      res.json({ data: rows[0] });
    })
  );

  /**
   * Reorder: accepts { ids: [3, 1, 2] } and writes sort_order by array position.
   * Runs in a transaction so a partial failure cannot leave a mangled order.
   */
  router.patch(
    '/reorder',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
      if (!ids || !ids.length) {
        return res.status(422).json({ errors: ['ids must be a non-empty array.'] });
      }

      const parsed = ids.map(parseId);
      if (parsed.some((id) => id === null)) {
        return res.status(422).json({ errors: ['ids must all be positive integers.'] });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < parsed.length; i += 1) {
          await client.query(
            'UPDATE categories SET sort_order = $1, updated_at = NOW() WHERE id = $2',
            [i, parsed[i]]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      res.json({ ok: true });
    })
  );

  /**
   * Delete. Refuses when dishes still reference the category, so menu items
   * can never be silently destroyed. The client should ask the admin to move
   * or remove those dishes first.
   */
  router.delete(
    '/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid category id.' });

      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS dish_count
           FROM ${DISHES_TABLE}
          WHERE ${DISHES_FK} = $1`,
        [id]
      );

      const dishCount = countRows[0] ? countRows[0].dish_count : 0;
      if (dishCount > 0) {
        return res.status(409).json({
          error: 'CATEGORY_NOT_EMPTY',
          dish_count: dishCount,
          message:
            `This category still contains ${dishCount} dish(es). ` +
            'Move or delete them first, or deactivate the category instead.',
        });
      }

      const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
      if (!rowCount) return res.status(404).json({ error: 'Category not found.' });

      res.status(204).end();
    })
  );

  return router;
}

module.exports = { createCategoriesRouter };
