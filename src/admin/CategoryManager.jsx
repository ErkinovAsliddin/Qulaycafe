import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from '../api/categories';
import './CategoryManager.css';

const EMPTY_FORM = {
  name_uz: '',
  name_ru: '',
  name_en: '',
  is_active: true,
};

/**
 * Admin screen for adding, editing, reordering, and deleting menu categories.
 * Mobile-first: rows render as stacked cards on small screens and as a table
 * layout from 720px up. All controls meet a 44px minimum touch target.
 */
export default function CategoryManager() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  const listRef = useRef(null);
  // Remembers which reorder button to re-focus once the list re-renders.
  const pendingFocus = useRef(null);

  /**
   * Reloads the list from the server.
   *
   * `keepMessage` leaves the current error banner in place. Failure handlers
   * resync to recover from stale state, and clearing the banner there would
   * discard the very message explaining why the resync happened (React batches
   * the two updates, so the empty string would win).
   */
  const refresh = useCallback(async ({ keepMessage = false } = {}) => {
    setLoading(true);
    if (!keepMessage) setError('');
    try {
      setCategories(await listCategories({ includeInactive: true }));
    } catch (err) {
      setError(err.message || 'Could not load categories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-dismiss the success banner so it does not linger over the list.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const sorted = useMemo(
    () =>
      [...categories].sort(
        (a, b) => a.sort_order - b.sort_order || a.id - b.id
      ),
    [categories]
  );

  /**
   * Reordering re-inserts the row's DOM node, which can drop keyboard focus.
   * Put it back on the same arrow button so repeated presses keep working.
   */
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !listRef.current) return;
    pendingFocus.current = null;
    const button = listRef.current.querySelector(
      `[data-move="${target.move}"][data-cat-id="${target.id}"]`
    );
    if (button) button.focus();
  }, [sorted]);

  function validateLocally(values) {
    const problems = [];
    if (!values.name_uz.trim()) problems.push('Uzbek name is required.');
    if (values.name_uz.trim().length > 120) problems.push('Uzbek name is too long.');
    return problems;
  }

  function errorList(err) {
    if (
      err instanceof ApiError &&
      err.payload &&
      Array.isArray(err.payload.errors) &&
      err.payload.errors.length
    ) {
      return err.payload.errors;
    }
    return [err.message || 'Something went wrong.'];
  }

  async function handleCreate(event) {
    event.preventDefault();
    const problems = validateLocally(createForm);
    if (problems.length) {
      setCreateErrors(problems);
      return;
    }

    setCreateErrors([]);
    setSaving(true);
    try {
      // sort_order is intentionally omitted so the server assigns the next
      // position itself. It does that under an advisory lock -- a single
      // MAX(sort_order) + 1 statement is not enough on its own, because
      // concurrent inserts read the same snapshot and derive the same value.
      const created = await createCategory(createForm);
      setCategories((prev) => [...prev, { dish_count: 0, ...created }]);
      setCreateForm(EMPTY_FORM);
      setNotice(`Added "${created.name_uz}".`);
    } catch (err) {
      setCreateErrors(errorList(err));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(category) {
    setEditingId(category.id);
    setEditErrors([]);
    setConfirmingId(null);
    setEditForm({
      name_uz: category.name_uz || '',
      name_ru: category.name_ru || '',
      name_en: category.name_en || '',
      is_active: Boolean(category.is_active),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditErrors([]);
    setEditForm(EMPTY_FORM);
  }

  async function handleUpdate(event, category) {
    event.preventDefault();
    const problems = validateLocally(editForm);
    if (problems.length) {
      setEditErrors(problems);
      return;
    }

    setEditErrors([]);
    setBusyId(category.id);
    try {
      // sort_order is omitted so saving an edit cannot write back a stale
      // position and undo a reorder made elsewhere in the meantime.
      const updated = await updateCategory(category.id, editForm);
      setCategories((prev) =>
        prev.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item
        )
      );
      setNotice(`Saved "${updated.name_uz}".`);
      cancelEdit();
    } catch (err) {
      setEditErrors(errorList(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(category) {
    const label = category.name_uz;
    setBusyId(category.id);
    setError('');
    try {
      await deleteCategory(category.id);
      setCategories((prev) => prev.filter((item) => item.id !== category.id));
      setConfirmingId(null);
      setNotice(`Deleted "${label}".`);
    } catch (err) {
      setError(err.message || 'Could not delete this category.');
      setConfirmingId(null);
      // The server is the source of truth on dish counts; resync, keeping the
      // message that explains the refusal.
      refresh({ keepMessage: true });
    } finally {
      setBusyId(null);
    }
  }

  async function move(category, direction) {
    // The arrow buttons stay focusable (aria-disabled) so keyboard users do not
    // lose their place, which means the no-op cases are guarded here instead.
    // Any in-flight request blocks a move, not just one on this row: the server
    // rejects a reorder that does not cover every category, so a move queued
    // behind a create or delete would be working from a list it cannot submit.
    if (busyId) return;

    const index = sorted.findIndex((item) => item.id === category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sorted.length) return;

    const next = [...sorted];
    [next[index], next[target]] = [next[target], next[index]];
    const reindexed = next.map((item, i) => ({ ...item, sort_order: i }));

    const previous = categories;
    pendingFocus.current = {
      id: category.id,
      move: direction < 0 ? 'up' : 'down',
    };
    setCategories(reindexed); // optimistic
    setBusyId(category.id);
    try {
      // The server requires every category in the payload, so send the whole
      // list rather than just the swapped pair.
      await reorderCategories(reindexed.map((item) => item.id));
    } catch (err) {
      setCategories(previous); // roll back on failure
      setError(err.message || 'Could not save the new order.');
      // 409 means this page no longer matches the server (another admin added
      // or removed a category). Resync so the next attempt covers every row.
      if (err instanceof ApiError && err.status === 409) {
        refresh({ keepMessage: true });
      }
    } finally {
      setBusyId(null);
    }
  }

  // Any pending request disables every arrow, matching the guard in move().
  const anyBusy = Boolean(busyId);

  return (
    <section className="cat-manager">
      <header className="cat-manager__header">
        <h1 className="cat-manager__title">Categories</h1>
        <p className="cat-manager__subtitle">
          Menu sections such as Birinchi taom and Ikkinchi taom. Order here is the
          order customers see.
        </p>
      </header>

      {notice ? (
        <p className="cat-alert cat-alert--success" role="status">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="cat-alert cat-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="cat-card cat-form" onSubmit={handleCreate} noValidate>
        <h2 className="cat-form__title">Add a category</h2>

        <div className="cat-field">
          <label className="cat-label" htmlFor="new-name-uz">
            Name (Uzbek) <span aria-hidden="true">*</span>
          </label>
          <input
            id="new-name-uz"
            className="cat-input"
            type="text"
            required
            maxLength={120}
            autoComplete="off"
            value={createForm.name_uz}
            onChange={(e) =>
              setCreateForm((prev) => ({ ...prev, name_uz: e.target.value }))
            }
          />
        </div>

        <div className="cat-field">
          <label className="cat-label" htmlFor="new-name-ru">
            Name (Russian)
          </label>
          <input
            id="new-name-ru"
            className="cat-input"
            type="text"
            maxLength={120}
            autoComplete="off"
            placeholder="Falls back to the Uzbek name"
            value={createForm.name_ru}
            onChange={(e) =>
              setCreateForm((prev) => ({ ...prev, name_ru: e.target.value }))
            }
          />
        </div>

        <div className="cat-field">
          <label className="cat-label" htmlFor="new-name-en">
            Name (English)
          </label>
          <input
            id="new-name-en"
            className="cat-input"
            type="text"
            maxLength={120}
            autoComplete="off"
            placeholder="Falls back to the Uzbek name"
            value={createForm.name_en}
            onChange={(e) =>
              setCreateForm((prev) => ({ ...prev, name_en: e.target.value }))
            }
          />
        </div>

        <label className="cat-checkbox">
          <input
            type="checkbox"
            checked={createForm.is_active}
            onChange={(e) =>
              setCreateForm((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />
          <span>Visible to customers</span>
        </label>

        {createErrors.length ? (
          <ul className="cat-errors" role="alert">
            {createErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}

        <button className="cat-btn cat-btn--primary" type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add category'}
        </button>
      </form>

      {loading ? (
        <p className="cat-empty">Loading categories…</p>
      ) : !sorted.length ? (
        <p className="cat-empty">No categories yet. Add your first one above.</p>
      ) : (
        <ul className="cat-list" ref={listRef}>
          {sorted.map((category, index) => {
            const isEditing = editingId === category.id;
            const isBusy = busyId === category.id;
            const isConfirming = confirmingId === category.id;
            const dishCount = category.dish_count || 0;
            const blocksDelete = dishCount > 0;
            const atTop = index === 0;
            const atBottom = index === sorted.length - 1;

            return (
              <li
                className={`cat-card cat-row${isConfirming ? ' cat-row--confirming' : ''}`}
                key={category.id}
              >
                {isEditing ? (
                  <form
                    className="cat-row__edit"
                    onSubmit={(e) => handleUpdate(e, category)}
                    noValidate
                  >
                    <div className="cat-field">
                      <label className="cat-label" htmlFor={`uz-${category.id}`}>
                        Name (Uzbek) <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id={`uz-${category.id}`}
                        className="cat-input"
                        type="text"
                        required
                        maxLength={120}
                        value={editForm.name_uz}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, name_uz: e.target.value }))
                        }
                      />
                    </div>

                    <div className="cat-field">
                      <label className="cat-label" htmlFor={`ru-${category.id}`}>
                        Name (Russian)
                      </label>
                      <input
                        id={`ru-${category.id}`}
                        className="cat-input"
                        type="text"
                        maxLength={120}
                        value={editForm.name_ru}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, name_ru: e.target.value }))
                        }
                      />
                    </div>

                    <div className="cat-field">
                      <label className="cat-label" htmlFor={`en-${category.id}`}>
                        Name (English)
                      </label>
                      <input
                        id={`en-${category.id}`}
                        className="cat-input"
                        type="text"
                        maxLength={120}
                        value={editForm.name_en}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, name_en: e.target.value }))
                        }
                      />
                    </div>

                    <label className="cat-checkbox">
                      <input
                        type="checkbox"
                        checked={editForm.is_active}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, is_active: e.target.checked }))
                        }
                      />
                      <span>Visible to customers</span>
                    </label>

                    {editErrors.length ? (
                      <ul className="cat-errors" role="alert">
                        {editErrors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="cat-row__actions">
                      <button
                        className="cat-btn cat-btn--primary"
                        type="submit"
                        disabled={isBusy}
                      >
                        {isBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        className="cat-btn cat-btn--ghost"
                        type="button"
                        onClick={cancelEdit}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="cat-row__main">
                      <span className="cat-row__name">{category.name_uz}</span>
                      <span className="cat-row__translations">
                        {category.name_ru} · {category.name_en}
                      </span>
                      <span className="cat-row__meta">
                        {dishCount === 1 ? '1 dish' : `${dishCount} dishes`}
                        {category.is_active ? null : (
                          <span className="cat-badge cat-badge--muted">Hidden</span>
                        )}
                      </span>
                    </div>

                    <div className="cat-row__actions">
                      <button
                        className="cat-btn cat-btn--icon"
                        type="button"
                        data-move="up"
                        data-cat-id={category.id}
                        onClick={() => move(category, -1)}
                        aria-disabled={anyBusy || atTop}
                        aria-label={`Move ${category.name_uz} up`}
                      >
                        ↑
                      </button>
                      <button
                        className="cat-btn cat-btn--icon"
                        type="button"
                        data-move="down"
                        data-cat-id={category.id}
                        onClick={() => move(category, 1)}
                        aria-disabled={anyBusy || atBottom}
                        aria-label={`Move ${category.name_uz} down`}
                      >
                        ↓
                      </button>
                      <button
                        className="cat-btn cat-btn--ghost"
                        type="button"
                        onClick={() => startEdit(category)}
                        disabled={isBusy}
                      >
                        Edit
                      </button>
                      <button
                        className="cat-btn cat-btn--danger"
                        type="button"
                        onClick={() => setConfirmingId(category.id)}
                        disabled={isBusy || isConfirming}
                        aria-expanded={isConfirming}
                      >
                        {isBusy ? '…' : 'Delete'}
                      </button>
                    </div>

                    {isConfirming ? (
                      <div
                        className="cat-confirm"
                        role="alert"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape' && !isBusy) {
                            e.stopPropagation();
                            setConfirmingId(null);
                          }
                        }}
                      >
                        {blocksDelete ? (
                          <>
                            <p className="cat-confirm__text">
                              {`"${category.name_uz}" still contains ${dishCount} ` +
                                `${dishCount === 1 ? 'dish' : 'dishes'}. Move or ` +
                                'delete those dishes first, or switch this category ' +
                                'off instead.'}
                            </p>
                            <div className="cat-confirm__actions">
                              <button
                                className="cat-btn cat-btn--ghost"
                                type="button"
                                autoFocus
                                onClick={() => setConfirmingId(null)}
                              >
                                Got it
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="cat-confirm__text">
                              {`Delete "${category.name_uz}"? This cannot be undone.`}
                            </p>
                            <div className="cat-confirm__actions">
                              <button
                                className="cat-btn cat-btn--ghost"
                                type="button"
                                autoFocus
                                onClick={() => setConfirmingId(null)}
                                disabled={isBusy}
                              >
                                Cancel
                              </button>
                              <button
                                className="cat-btn cat-btn--danger"
                                type="button"
                                onClick={() => handleDelete(category)}
                                disabled={isBusy}
                              >
                                {isBusy ? 'Deleting…' : 'Yes, delete'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
