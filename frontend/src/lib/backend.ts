/**
 * Backend Proxy Layer
 *
 * Proxies requests from Vercel to the Python backend on Fly.io.
 * Falls back to local filesystem/legacy behavior when PY_BACKEND_URL is not set.
 */

// Backend URL from environment (set in Vercel)
export const BACKEND_URL = process.env.PY_BACKEND_URL || '';

/**
 * Check if we should use the Python backend
 */
export function useBackend(): boolean {
  return BACKEND_URL.length > 0;
}

/**
 * Make a request to the backend
 */
export async function backendFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!BACKEND_URL) {
    throw new Error('PY_BACKEND_URL not configured');
  }

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
