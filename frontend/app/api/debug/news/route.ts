import { NextResponse } from 'next/server';
import { testNewsApiConnection } from '@/lib/newsapi';

export async function GET() {
  const result = await testNewsApiConnection();
  return NextResponse.json(result);
}
