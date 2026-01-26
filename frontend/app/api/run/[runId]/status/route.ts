import { NextRequest, NextResponse } from 'next/server';
import { exists, readArtifact } from '@/src/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    
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
