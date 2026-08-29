import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, RATE_LIMITS, rateLimitResponse } from '@/src/lib/rateLimit';
import { validateRunId, validateDebateRequest } from '@/src/lib/validation';
import { useBackend, backendPost } from '@/src/lib/backend';

/**
 * Start the debate for a run.
 *
 * This file used to carry a SECOND, complete debate implementation inline below
 * the `useBackend()` branch: bull/bear/regime/VOLUME/judge with terse prompts,
 * against the Python service's bull/bear/regime/VALUE/judge. Two rosters, two
 * sets of prompts, and the TypeScript one silently reachable whenever
 * PY_BACKEND_URL was unset or typo'd. backend/main.py had taken eight commits
 * since the split; this copy had taken none.
 *
 * It is gone. Local development runs the same Python service on 127.0.0.1:8000
 * (see src/lib/backend.ts), so there is one implementation to reason about and
 * exactly one to evaluate.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const clientIp = getClientIp(request.headers);
  const rateLimitResult = checkRateLimit(clientIp, RATE_LIMITS.heavy);
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  const { runId } = await params;

  const runIdValidation = validateRunId(runId);
  if (!runIdValidation.success) {
    return NextResponse.json({ error: runIdValidation.error }, { status: 400 });
  }

  try {
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const bodyValidation = validateDebateRequest(rawBody);
    if (!bodyValidation.success) {
      return NextResponse.json({ error: bodyValidation.error }, { status: 400 });
    }

    const extras = bodyValidation.data?.extras || [];

    if (!useBackend()) {
      return NextResponse.json(
        {
          error:
            'PY_BACKEND_URL is not configured. The debate runs in the Python ' +
            'service (backend/main.py); there is no in-process fallback. In ' +
            'development it defaults to http://127.0.0.1:8000 - start it with ' +
            '`uvicorn main:app --app-dir backend --reload --port 8000`.',
        },
        { status: 503 }
      );
    }

    const result = await backendPost<{ success: boolean; message?: string }>(
      `/run/${runId}/debate`,
      { extras }
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('Debate error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
