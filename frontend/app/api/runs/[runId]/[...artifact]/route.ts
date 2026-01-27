import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { useBackend, backendFetch } from '@/src/lib/backend';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; artifact: string[] }> }
) {
  try {
    const { runId, artifact } = await params;
    const artifactPath = artifact.join('/');

    // Security: validate runId format (YYYYMMDD_HHMMSS or test_*)
    if (!/^(\d{8}_\d{6}|test_\w+)$/.test(runId)) {
      return NextResponse.json({ error: 'Invalid runId format' }, { status: 400 });
    }

    // Security: no path traversal
    if (artifactPath.includes('..') || artifactPath.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    // ========================================================================
    // PROXY TO PYTHON BACKEND
    // ========================================================================
    if (useBackend()) {
      try {
        const response = await backendFetch(`/run/${runId}/artifact/${artifactPath}`, {
          method: 'GET',
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Not found' }));
          return NextResponse.json(
            { error: error.detail || error.error || 'Not found' },
            { status: response.status }
          );
        }

        // Determine content type based on path
        const ext = path.extname(artifactPath).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.json') contentType = 'application/json';
        else if (ext === '.txt') contentType = 'text/plain';
        else if (ext === '.csv') contentType = 'text/csv';
        else if (ext === '.md') contentType = 'text/markdown';

        const content = await response.text();

        return new NextResponse(content, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      } catch (e) {
        console.error('Backend fetch error:', e);
        return NextResponse.json(
          { error: 'Failed to fetch from backend' },
          { status: 502 }
        );
      }
    }

    // ========================================================================
    // LEGACY: Local filesystem
    // ========================================================================
    const repoRoot = path.join(process.cwd(), '..');
    const filePath = path.join(repoRoot, 'runs', runId, artifactPath);

    // Security: ensure path stays within runs directory
    const runsDir = path.resolve(repoRoot, 'runs');
    const resolvedPath = path.resolve(filePath);

    if (!resolvedPath.startsWith(runsDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Cannot read directory' }, { status: 400 });
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');

    // Determine content type
    const ext = path.extname(resolvedPath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.json') contentType = 'application/json';
    else if (ext === '.txt') contentType = 'text/plain';
    else if (ext === '.csv') contentType = 'text/csv';
    else if (ext === '.md') contentType = 'text/markdown';

    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });

  } catch (error) {
    console.error('Error reading artifact:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
