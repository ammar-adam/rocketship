import { NextRequest, NextResponse } from 'next/server';
import { useBackend, backendPost } from '@/src/lib/backend';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 });
    }

    const body = await request.json();
    const ticker = (body?.ticker ?? '').toString().trim();
    const reason = (body?.reason ?? 'user_timeout').toString().trim() || 'user_timeout';

    if (!ticker) {
      return NextResponse.json({ error: 'ticker required' }, { status: 400 });
    }

    if (useBackend()) {
      const result = await backendPost<{ success: boolean; ticker: string; reason: string }>(
        `/run/${runId}/skip`,
        { ticker: ticker.toUpperCase(), reason }
      );

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error ?? 'Failed to skip' },
          { status: result.status ?? 500 }
        );
      }

      return NextResponse.json(result.data ?? { success: true, ticker, reason });
    }

    return NextResponse.json(
      { error: 'Skip is only available when using Python backend (PY_BACKEND_URL)' },
      { status: 501 }
    );
  } catch (error) {
    console.error('Skip error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
