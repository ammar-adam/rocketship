import { NextResponse } from 'next/server';
import { BACKEND_URL, useBackend, backendGet } from '@/src/lib/backend';

/**
 * Health check endpoint for the Next.js frontend.
 * Returns:
 * - ok: true if the frontend is running
 * - backend: the configured PY_BACKEND_URL
 * - backendHealthy: true if backend /health returns 200
 */
export async function GET() {
  const backendConfigured = useBackend();
  let backendHealthy = false;
  let backendError: string | null = null;

  // If backend is configured, test connectivity
  if (backendConfigured) {
    try {
      const result = await backendGet<{ status: string }>('/health');
      backendHealthy = result.ok && result.data?.status === 'ok';
      if (!result.ok) {
        backendError = result.error || 'Backend returned error';
      }
    } catch (e) {
      backendError = e instanceof Error ? e.message : 'Unknown error';
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    backend: backendConfigured ? BACKEND_URL : '(not configured - using legacy local mode)',
    backendConfigured,
    backendHealthy,
    backendError,
  });
}
