import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
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

  function validateLocally(values) {
    const problems = [];
    if (!values.name_uz.trim()) problems.push('Uzbek name is required.');
    if (values.name_uz.trim().length > 120) problems.push('Uzbek name is too long.');
    return problems;
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
      const created = await createCategory({
        ...createForm,
        sort_order: sorted.length,
      });
      setCategories((prev) => [...prev, created]);
      setCreateForm(EMPTY_FORM);
      setNotice(`Added "${created.name_uz}".`);
    } catch (err) {
      const list =
        err instanceof ApiError && err.payload && Array.isArray(err.payload.errors)
          ? err.payload.errors
          : [err.message];
      setCreateErrors(list);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(category) {
    setEditingId(category.id);
    setEditErrors([]);
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
      const updated = await updateCategory(category.id, {
        ...editForm,
        sort_order: category.sort_order,
      });
      setCategories((prev) =>
        prev.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item
        )
      );
      setNotice(`Saved "${updated.name_uz}".`);
      cancelEdit();
    } catch (err) {
      const list =
        err instanceof ApiError && err.payload && Array.isArray(err.payload.errors)
          ? err.payload.errors
          : [err.message];
      setEditErrors(list);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(category) {
    const label = category.name_uz;
    if (category.dish_count > 0) {
      window.alert(
        `"${label}" still contains ${category.dish_count} dish(es). ` +
          'Move or delete those dishes first, or switch the category off instead.'
      );
      return;
    }
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;

    setBusyId(category.id);
    setError('');
    try {
      await deleteCategory(category.id);
      setCategories((prev) => prev.filter((item) => item.id !== category.id));
      setNotice(`Deleted "${label}".`);
    } catch (err) {
      setError(err.message || 'Could not delete this category.');
      // The server is the source of truth on dish counts; resync.
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function move(category, direction) {
    const index = sorted.findIndex((item) => item.id === category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sorted.length) return;

    const next = [...sorted];
    [next[index], next[target]] = [next[target], next[index]];
    const reindexed = next.map((item, i) => ({ ...item, sort_order: i }));

    const previous = categories;
    setCategories(reindexed); // optimistic
    setBusyId(category.id);
    try {
      await reorderCategories(reindexed.map((item) => item.id));
    } catch (err) {
      setCategories(previous); // roll back on failure
      setError(err.message || 'Could not save the new order.');
    } finally {
      setBusyId(null);
    }
  }

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
        <ul className="cat-list">
          {sorted.map((category, index) => {
            const isEditing = editingId === category.id;
            const isBusy = busyId === category.id;

            return (
              <li className="cat-card cat-row" key={category.id}>
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
                        {category.dish_count === 1
                          ? '1 dish'
                          : `${category.dish_count || 0} dishes`}
                        {category.is_active ? null : (
                          <span className="cat-badge cat-badge--muted">Hidden</span>
                        )}
                      </span>
                    </div>

                    <div className="cat-row__actions">
                      <button
                        className="cat-btn cat-btn--icon"
                        type="button"
                        onClick={() => move(category, -1)}
                        disabled={isBusy || index === 0}
                        aria-label={`Move ${category.name_uz} up`}
                      >
                        ↑
                      </button>
                      <button
                        className="cat-btn cat-btn--icon"
                        type="button"
                        onClick={() => move(category, 1)}
                        disabled={isBusy || index === sorted.length - 1}
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
                        onClick={() => handleDelete(category)}
                        disabled={isBusy}
                      >
                        {isBusy ? '…' : 'Delete'}
                      </button>
                    </div>
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
