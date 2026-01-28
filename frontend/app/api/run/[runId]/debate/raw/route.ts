import { NextRequest, NextResponse } from 'next/server';
import { useBackend, backendGet } from '@/src/lib/backend';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json(
        { error: 'ticker query parameter required' },
        { status: 400 }
      );
    }

    // PROXY TO PYTHON BACKEND
    if (useBackend()) {
      const result = await backendGet<{
        ticker: string;
        raw_outputs: Record<string, string>;
        news: unknown;
      }>(`/run/${runId}/debate/raw?ticker=${encodeURIComponent(ticker)}`);

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json(result.data);
    }

    // LEGACY: Local mode (not implemented for raw)
    return NextResponse.json(
      { error: 'Raw endpoint requires backend' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Raw endpoint error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
