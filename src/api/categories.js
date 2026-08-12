/**
 * Categories API client.
 * Set VITE_API_BASE_URL (or leave blank to use same-origin /api).
 */

const BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) || '';

const ENDPOINT = `${BASE}/api/categories`;

/** Error carrying the HTTP status and any structured payload from the server. */
export class ApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload || null;
  }
}

async function request(path, options = {}) {
  // Destructure `headers` out so caller-supplied headers merge with the
  // defaults instead of replacing them (which would drop Content-Type).
  const { headers, ...rest } = options;

  const response = await fetch(`${ENDPOINT}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
  });

  if (response.status === 204) return null;

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      (payload && (payload.message || payload.error)) ||
      (payload && Array.isArray(payload.errors) && payload.errors.join(' ')) ||
      `Request failed with status ${response.status}.`;
    throw new ApiError(message, { status: response.status, payload });
  }

  return payload;
}

export async function listCategories({ includeInactive = false } = {}) {
  const query = includeInactive ? '?includeInactive=1' : '';
  const result = await request(`/${query}`, { method: 'GET' });
  return (result && result.data) || [];
}

export async function createCategory(values) {
  const result = await request('/', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  return result && result.data;
}

export async function updateCategory(id, values) {
  const result = await request(`/${id}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  });
  return result && result.data;
}

export async function deleteCategory(id) {
  await request(`/${id}`, { method: 'DELETE' });
}

export async function reorderCategories(ids) {
  await request('/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ ids }),
  });
}
