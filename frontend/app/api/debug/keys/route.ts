import { NextResponse } from 'next/server';
import { getKeyInfo } from '@/lib/env';

export async function GET() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;
  
  return NextResponse.json({
    deepseek: getKeyInfo(deepseekKey),
    newsapi: getKeyInfo(newsApiKey)
  });
}
