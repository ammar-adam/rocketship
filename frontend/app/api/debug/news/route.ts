import { NextResponse } from 'next/server';
import { testNewsApiConnection } from '@/lib/newsapi';

export async function GET() {
  const apiKey = process.env.NEWS_API_KEY;
  
  if (!apiKey || apiKey.length < 20) {
    return NextResponse.json(
      { error: 'Missing NEWS_API_KEY' },
      { status: 500 }
    );
  }
  
  const result = await testNewsApiConnection();
  return NextResponse.json(result);
}
