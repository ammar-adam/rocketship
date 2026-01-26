/**
 * Storage Abstraction Layer
 *
 * Provides a unified interface for storing run artifacts that works:
 * - Locally: Uses filesystem (runs/ directory)
 * - Vercel: Uses Vercel Blob Storage or falls back to /tmp
 *
 * Set BLOB_READ_WRITE_TOKEN env var in Vercel for production blob storage.
 */

import path from 'path';
import fs from 'fs/promises';

// Detect environment
const isVercel = process.env.VERCEL === '1';
const hasBlobToken = !!(process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN.length > 10);

// Storage mode
export type StorageMode = 'filesystem' | 'vercel-blob' | 'vercel-tmp';
export const storageMode: StorageMode = isVercel
  ? (hasBlobToken ? 'vercel-blob' : 'vercel-tmp')
  : 'filesystem';

/**
 * Get the base path for run artifacts
 */
function getRunsBasePath(): string {
  if (storageMode === 'vercel-tmp') {
    return '/tmp/runs';
  }
  // Local filesystem - runs/ directory at repo root
  return path.join(process.cwd(), '..', 'runs');
}

/**
 * Get the full path for a run directory
 */
export function getRunPath(runId: string): string {
  if (!/^(\d{8}_\d{6}|test_\w+)$/.test(runId)) {
    throw new Error(`Invalid runId format: ${runId}`);
  }
  return path.join(getRunsBasePath(), runId);
}

/**
 * Get the full path for an artifact within a run
 */
export function getArtifactPath(runId: string, artifactPath: string): string {
  // Security: prevent path traversal
  if (artifactPath.includes('..') || artifactPath.startsWith('/')) {
    throw new Error('Invalid artifact path');
  }
  return path.join(getRunPath(runId), artifactPath);
}

/**
 * Ensure a directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Save text content to storage
 */
export async function saveText(runId: string, artifactPath: string, content: string): Promise<void> {
  if (storageMode === 'vercel-blob' && hasBlobToken) {
    // Use Vercel Blob Storage
    const { put } = await import('@vercel/blob');
    const blobPath = `runs/${runId}/${artifactPath}`;
    await put(blobPath, content, {
      access: 'public',
      contentType: artifactPath.endsWith('.json') ? 'application/json' : 'text/plain'
    });
  } else {
    // Filesystem (local or Vercel /tmp)
    const fullPath = getArtifactPath(runId, artifactPath);
    await ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}

/**
 * Save JSON content to storage
 */
export async function saveJson(runId: string, artifactPath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await saveText(runId, artifactPath, content);
}

/**
 * Append text to a file (logs)
 */
export async function appendText(runId: string, artifactPath: string, content: string): Promise<void> {
  if (storageMode === 'vercel-blob') {
    // Blob storage doesn't support append - read + write
    try {
      const existing = await readText(runId, artifactPath);
      await saveText(runId, artifactPath, existing + content);
    } catch {
      // File doesn't exist, create it
      await saveText(runId, artifactPath, content);
    }
  } else {
    const fullPath = getArtifactPath(runId, artifactPath);
    await ensureDir(path.dirname(fullPath));
    await fs.appendFile(fullPath, content, 'utf-8');
  }
}

/**
 * Read text content from storage
 */
export async function readText(runId: string, artifactPath: string): Promise<string> {
  if (storageMode === 'vercel-blob' && hasBlobToken) {
    const { head } = await import('@vercel/blob');
    const blobPath = `runs/${runId}/${artifactPath}`;
    const blob = await head(blobPath);
    if (!blob) {
      throw new Error(`Artifact not found: ${blobPath}`);
    }
    const response = await fetch(blob.url);
    return response.text();
  } else {
    const fullPath = getArtifactPath(runId, artifactPath);
    return fs.readFile(fullPath, 'utf-8');
  }
}

/**
 * Read JSON content from storage
 */
export async function readJson<T = unknown>(runId: string, artifactPath: string): Promise<T> {
  const content = await readText(runId, artifactPath);
  return JSON.parse(content);
}

/**
 * Check if an artifact exists
 */
export async function exists(runId: string, artifactPath: string): Promise<boolean> {
  if (storageMode === 'vercel-blob' && hasBlobToken) {
    try {
      const { head } = await import('@vercel/blob');
      const blobPath = `runs/${runId}/${artifactPath}`;
      const blob = await head(blobPath);
      return !!blob;
    } catch {
      return false;
    }
  } else {
    try {
      const fullPath = getArtifactPath(runId, artifactPath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * List files in a directory (prefix for blob storage)
 */
export async function list(runId: string, prefix: string = ''): Promise<string[]> {
  if (storageMode === 'vercel-blob' && hasBlobToken) {
    const { list: blobList } = await import('@vercel/blob');
    const blobPrefix = prefix ? `runs/${runId}/${prefix}` : `runs/${runId}/`;
    const { blobs } = await blobList({ prefix: blobPrefix });
    return blobs.map(b => b.pathname.replace(`runs/${runId}/`, ''));
  } else {
    const dirPath = prefix
      ? getArtifactPath(runId, prefix)
      : getRunPath(runId);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.map(e => e.name);
    } catch {
      return [];
    }
  }
}

/**
 * List all run IDs
 */
export async function listRuns(): Promise<string[]> {
  if (storageMode === 'vercel-blob' && hasBlobToken) {
    const { list: blobList } = await import('@vercel/blob');
    const { blobs } = await blobList({ prefix: 'runs/' });
    // Extract unique run IDs
    const runIds = new Set<string>();
    for (const blob of blobs) {
      const match = blob.pathname.match(/^runs\/(\d{8}_\d{6}|test_\w+)\//);
      if (match) {
        runIds.add(match[1]);
      }
    }
    return Array.from(runIds).sort().reverse();
  } else {
    const basePath = getRunsBasePath();
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && /^(\d{8}_\d{6}|test_\w+)$/.test(e.name))
        .map(e => e.name)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
}

/**
 * Delete a run and all its artifacts
 */
export async function deleteRun(runId: string): Promise<void> {
  if (storageMode === 'vercel-blob' && hasBlobToken) {
    const { del, list: blobList } = await import('@vercel/blob');
    const blobPrefix = `runs/${runId}/`;
    const { blobs } = await blobList({ prefix: blobPrefix });
    for (const blob of blobs) {
      await del(blob.url);
    }
  } else {
    const runPath = getRunPath(runId);
    await fs.rm(runPath, { recursive: true, force: true });
  }
}

/**
 * Get storage info for debugging
 */
export function getStorageInfo(): { mode: StorageMode; basePath: string; hasBlobToken: boolean } {
  return {
    mode: storageMode,
    basePath: getRunsBasePath(),
    hasBlobToken
  };
}
