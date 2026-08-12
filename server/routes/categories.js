'use strict';

const express = require('express');

/** Postgres unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Advisory lock key guarding sort_order assignment.
 *
 * Any arbitrary constant works; it only has to be the same everywhere in this
 * file. Kept distinct from other advisory locks in the app.
 */
const SORT_ORDER_LOCK_KEY = 7241001;

/** Error that carries the HTTP status and body to send back. */
class HttpError extends Error {
  constructor(status, payload) {
    super((payload && (payload.message || payload.error)) || 'Request failed.');
    this.name = 'HttpError';
    this.status = status;
    this.payload = payload;
  }
}

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

  /**
   * Wraps a handler so a thrown HttpError becomes its status and body, and
   * anything else reaches the app error handler.
   */
  const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      if (err instanceof HttpError && !res.headersSent) {
        return res.status(err.status).json(err.payload);
      }
      return next(err);
    });
  };

  /**
   * Runs `handler` inside a transaction. Throwing (including HttpError, used
   * for validation failures that need the transaction abandoned) rolls back.
   *
   * The rollback is guarded so a failure while unwinding cannot replace the
   * original error with a less informative one.
   */
  async function withTransaction(handler) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Surface the original failure; the connection is discarded below.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Serializes everything that assigns sort_order: create, update with an
   * explicit position, and reorder.
   *
   * Computing a position from MAX(sort_order) is not safe on its own, even in
   * a single statement: concurrent transactions read the same snapshot and
   * derive the same next position. Row locks do not close the gap either,
   * because they cannot block an INSERT, so a category created mid-reorder
   * would escape the reorder's completeness check and keep a colliding
   * position. The lock is released when the transaction ends.
   */
  const lockSortOrder = (client) =>
    client.query('SELECT pg_advisory_xact_lock($1)', [SORT_ORDER_LOCK_KEY]);

  const trimOrNull = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const wantsInactive = (req) =>
    req.query.includeInactive === '1' || req.query.includeInactive === 'true';

  /**
   * The reads below are public because the customer-facing menu uses them, but
   * `includeInactive` exposes sections the admin deliberately switched off.
   * Gate the flag (not the whole route) behind requireAdmin so anonymous
   * callers can never enumerate hidden categories -- on the list *or* by
   * guessing ids on the detail route.
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
   * current position, both computed in SQL under the advisory lock so
   * concurrent admins cannot end up with duplicate positions.
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
  // Public reads: used by the customer-facing menu. Anonymous callers see only
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

  /**
   * Single category. Filtered the same way as the list: without an admin
   * session and `includeInactive=1`, a deactivated category reports 404 rather
   * than 403, so the response does not reveal that the id exists.
   */
  router.get(
    '/:id',
    requireAdminForInactive,
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid category id.' });

      const includeInactive = wantsInactive(req);

      const { rows } = await pool.query(
        `SELECT id, name_uz, name_ru, name_en, sort_order, is_active
           FROM categories
          WHERE id = $1
            AND ($2::boolean OR is_active = TRUE)`,
        [id, includeInactive]
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

      let created;
      try {
        created = await withTransaction(async (client) => {
          // Hold the lock even when the caller supplied an explicit position,
          // so a create can never interleave with a reorder.
          await lockSortOrder(client);

          const { rows } = await client.query(
            `INSERT INTO categories (name_uz, name_ru, name_en, sort_order, is_active)
             SELECT $1, $2, $3,
                    COALESCE(
                      $4::int,
                      (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM categories)
                    ),
                    $5
             RETURNING id, name_uz, name_ru, name_en, sort_order, is_active`,
            [values.nameUz, values.nameRu, values.nameEn, values.sortOrder, values.isActive]
          );

          return rows[0];
        });
      } catch (err) {
        if (err && err.code === UNIQUE_VIOLATION) return duplicateName(res);
        throw err;
      }

      res.status(201).json({ data: created });
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

      let updated;
      try {
        updated = await withTransaction(async (client) => {
          // Only an explicit position competes with reorder; the common case
          // (omitted sort_order) keeps whatever is stored and needs no lock.
          if (values.sortOrder !== null) {
            await lockSortOrder(client);
          }

          const { rows } = await client.query(
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
          );

          if (!rows.length) {
            throw new HttpError(404, { error: 'Category not found.' });
          }

          return rows[0];
        });
      } catch (err) {
        if (err && err.code === UNIQUE_VIOLATION) return duplicateName(res);
        throw err;
      }

      res.json({ data: updated });
    })
  );

  /**
   * Reorder: accepts { ids: [3, 1, 2] } and writes sort_order by array position.
   *
   * The payload must list every category exactly once. A partial list would
   * renumber only the ids it contains while the rest keep their old positions,
   * which yields duplicate sort_order values and an order that then depends on
   * the id tiebreak. A list that does not match the table means the caller is
   * working from a stale view, so it is rejected with 409 rather than applied.
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

      const unique = new Set(parsed);
      if (unique.size !== parsed.length) {
        return res.status(422).json({ errors: ['ids must not contain duplicates.'] });
      }

      const staleMessage =
        'The category list changed since this page was loaded. ' +
        'Refresh and try reordering again.';

      await withTransaction(async (client) => {
        // The advisory lock keeps concurrent creates and explicit sort_order
        // updates out; FOR UPDATE below additionally blocks deletes of the
        // rows being renumbered.
        await lockSortOrder(client);

        // Fixed id order so concurrent reorders queue instead of deadlocking.
        const { rows: existing } = await client.query(
          'SELECT id FROM categories ORDER BY id FOR UPDATE'
        );
        const known = new Set(existing.map((row) => row.id));

        const unknown = parsed.filter((id) => !known.has(id));
        if (unknown.length) {
          throw new HttpError(422, {
            error: 'CATEGORY_NOT_FOUND',
            errors: [`Unknown category id(s): ${unknown.join(', ')}.`],
            message: staleMessage,
          });
        }

        if (parsed.length !== known.size) {
          throw new HttpError(409, {
            error: 'CATEGORY_LIST_STALE',
            expected_count: known.size,
            received_count: parsed.length,
            errors: [staleMessage],
            message: staleMessage,
          });
        }

        // WITH ORDINALITY is 1-based; store 0-based to match the client.
        await client.query(
          `UPDATE categories AS c
              SET sort_order = v.position - 1,
                  updated_at = NOW()
             FROM unnest($1::int[]) WITH ORDINALITY AS v(id, position)
            WHERE c.id = v.id
              AND c.sort_order IS DISTINCT FROM v.position - 1`,
          [parsed]
        );
      });

      res.json({ ok: true });
    })
  );

  /**
   * Delete. Refuses when dishes still reference the category, so menu items
   * can never be silently destroyed. The client should ask the admin to move
   * or remove those dishes first.
   *
   * The count and the delete run in one transaction, and the category row is
   * locked FOR UPDATE first. Inserting a dish takes a FOR KEY SHARE lock on
   * its parent category, which conflicts with FOR UPDATE, so a dish cannot be
   * added between the check and the delete and slip past the guard. Without
   * this, the outcome would depend on the foreign key's delete action -- and
   * ON DELETE CASCADE would destroy the very dishes this check protects.
   */
  router.delete(
    '/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid category id.' });

      await withTransaction(async (client) => {
        const { rows: locked } = await client.query(
          'SELECT id FROM categories WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (!locked.length) {
          throw new HttpError(404, { error: 'Category not found.' });
        }

        const { rows: countRows } = await client.query(
          `SELECT COUNT(*)::int AS dish_count
             FROM ${DISHES_TABLE}
            WHERE ${DISHES_FK} = $1`,
          [id]
        );

        const dishCount = countRows[0] ? countRows[0].dish_count : 0;
        if (dishCount > 0) {
          throw new HttpError(409, {
            error: 'CATEGORY_NOT_EMPTY',
            dish_count: dishCount,
            message:
              `This category still contains ${dishCount} dish(es). ` +
              'Move or delete them first, or deactivate the category instead.',
          });
        }

        await client.query('DELETE FROM categories WHERE id = $1', [id]);
      });

      res.status(204).end();
    })
  );

  return router;
}

module.exports = { createCategoriesRouter };
