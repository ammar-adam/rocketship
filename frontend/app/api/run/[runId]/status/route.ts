import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const repoRoot = path.join(process.cwd(), '..');
    const statusPath = path.join(repoRoot, 'runs', runId, 'status.json');
    
    if (!fs.existsSync(statusPath)) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }
    
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    return NextResponse.json(status);
    
  } catch (error) {
    console.error('Error reading status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
