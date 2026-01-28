import { NextRequest, NextResponse } from 'next/server';
import { useBackend, backendGet } from '@/src/lib/backend';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    // PROXY TO PYTHON BACKEND
    if (useBackend()) {
      const result = await backendGet<{
        runId: string;
        selection?: {
          total: number;
          breakdown: Record<string, number>;
          tickers: string[];
        };
        summary?: {
          buy_count: number;
          hold_count: number;
          sell_count: number;
          total: number;
        };
        per_ticker: Record<string, {
          bull?: { present: boolean; has_thesis?: boolean; has_raw?: boolean; has_error?: boolean };
          bear?: { present: boolean; has_thesis?: boolean; has_raw?: boolean; has_error?: boolean };
          regime?: { present: boolean; has_thesis?: boolean; has_raw?: boolean; has_error?: boolean };
          value?: { present: boolean; has_thesis?: boolean; has_raw?: boolean; has_error?: boolean };
          judge?: { present: boolean; verdict?: string; confidence?: number; has_raw?: boolean };
          news_present?: boolean;
        }>;
      }>(`/run/${runId}/debate/debug`);

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json(result.data);
    }

    // LEGACY: Local mode (not implemented for debug)
    return NextResponse.json(
      { error: 'Debug endpoint requires backend' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
