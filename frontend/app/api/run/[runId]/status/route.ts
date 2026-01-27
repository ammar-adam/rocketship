import { NextRequest, NextResponse } from 'next/server';
import { useBackend, backendGet } from '@/src/lib/backend';
import { exists, readArtifact } from '@/src/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    // ========================================================================
    // PROXY TO PYTHON BACKEND
    // ========================================================================
    if (useBackend()) {
      const result = await backendGet<{
        runId: string;
        stage: string;
        progress: object;
        updatedAt: string;
        errors: string[];
      }>(`/run/${runId}/status`);

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json(result.data);
    }

    // ========================================================================
    // LEGACY: Local filesystem
    // ========================================================================
    if (!(await exists(runId, 'status.json'))) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    const statusContent = await readArtifact(runId, 'status.json');
    const status = JSON.parse(statusContent);
    return NextResponse.json(status);

  } catch (error) {
    console.error('Error reading status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
