import { NextResponse } from 'next/server';
import { DEEPSEEK_MODEL, DEEPSEEK_THINKING } from '@/src/lib/model';

export async function GET() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  
  if (!apiKey || apiKey.length < 20) {
    return NextResponse.json(
      { error: 'Missing DEEPSEEK_API_KEY' },
      { status: 500 }
    );
  }
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: 'You are a health check endpoint. Reply with valid JSON: {"status":"ok"}' },
          { role: 'user', content: 'Health check - respond with json status' }
        ],
        temperature: 0,
        max_tokens: 20,
        response_format: { type: 'json_object' },
        thinking: DEEPSEEK_THINKING
      })
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        canReach: false,
        modelUsed: DEEPSEEK_MODEL,
        latencyMs,
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`
      });
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    return NextResponse.json({
      canReach: true,
      modelUsed: data.model || DEEPSEEK_MODEL,
      latencyMs,
      response: content
    });
    
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return NextResponse.json({
      canReach: false,
      modelUsed: null,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
