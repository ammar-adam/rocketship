/**
 * Backend Proxy Layer
 *
 * The Python service (backend/main.py) is the ONE debate implementation. This
 * module routes every mutating request to it.
 *
 * History worth knowing: `useBackend()` used to be a silent feature flag. When
 * PY_BACKEND_URL was missing or typo'd the app fell through to a second,
 * divergent TypeScript debate (a `volume` agent where Python has `value`) that
 * spawned `py`/`python3` inside a serverless function. That silence is why two
 * agent rosters coexisted for months. It no longer degrades quietly:
 *
 *   - production without PY_BACKEND_URL  -> throws at first use
 *   - development without PY_BACKEND_URL -> defaults to a LOCAL FastAPI on
 *     127.0.0.1:8000, i.e. the same implementation, run locally
 *
 * Start the local backend with:
 *   uvicorn main:app --app-dir backend --reload --port 8000
 */

const LOCAL_BACKEND = 'http://127.0.0.1:8000';

function resolveBackendUrl(): string {
  const configured = (process.env.PY_BACKEND_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return '';
  return LOCAL_BACKEND;
}

export const BACKEND_URL = resolveBackendUrl();

/** True when a backend URL is available. Always true outside production. */
export function useBackend(): boolean {
  return BACKEND_URL.length > 0;
}

/**
 * Throws with an actionable message rather than silently taking a second code
 * path. Called by backendFetch, so every proxied route inherits it.
 */
export function assertBackendConfigured(): void {
  if (BACKEND_URL.length > 0) return;
  throw new Error(
    'PY_BACKEND_URL is not set. It is required in production and is set in the ' +
    'Vercel dashboard, not in this repo. There is no fallback debate path any ' +
    'more: the Python service in backend/main.py is the only implementation.'
  );
}

/**
 * Make a request to the backend
 */
export async function backendFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  assertBackendConfigured();

  const url = `${BACKEND_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return response;
}

/**
 * Proxy a POST request to the backend
 */
export async function backendPost<T = unknown>(
  path: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  try {
    const response = await backendFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: data.detail || data.error || 'Backend error',
        status: response.status,
      };
    }

    return { ok: true, data: data as T, status: response.status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      status: 500,
    };
  }
}

/**
 * Proxy a GET request to the backend
 */
export async function backendGet<T = unknown>(
  path: string
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  try {
    const response = await backendFetch(path, { method: 'GET' });

    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: data.detail || data.error || 'Backend error',
        status: response.status,
      };
    }

    return { ok: true, data: data as T, status: response.status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      status: 500,
    };
  }
}
