import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

const DEEPSEEK_API_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; ticker: string }> }
) {
  const { runId, ticker } = await params;
  
  try {
    const body = await request.json();
    const { from, target } = body;
    
    if (!from || !target || !['bull', 'bear'].includes(from) || !['bull', 'bear'].includes(target)) {
      return NextResponse.json(
        { error: 'Invalid from/target. Must be "bull" or "bear".' },
        { status: 400 }
      );
    }
    
    if (from === target) {
      return NextResponse.json(
        { error: 'from and target must be different' },
        { status: 400 }
      );
    }
    
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey.length < 20) {
      return NextResponse.json(
        { ok: false, error: 'DEEPSEEK_API_KEY not configured' },
        { status: 500 }
      );
    }
    
    const runsDir = path.join(process.cwd(), '..', 'runs', runId);
    const debatePath = path.join(runsDir, 'debate', `${ticker.toUpperCase()}.json`);
    
    // Read existing debate
    let debate;
    try {
      const debateData = await fs.readFile(debatePath, 'utf-8');
      debate = JSON.parse(debateData);
    } catch {
      return NextResponse.json(
        { error: `Debate file not found for ${ticker}` },
        { status: 404 }
      );
    }
    
    const fromAgent = debate.agents?.[from];
    const targetAgent = debate.agents?.[target];
    
    if (!fromAgent || !targetAgent) {
      return NextResponse.json(
        { error: `Agent data missing for ${from} or ${target}` },
        { status: 400 }
      );
    }
    
    // Build critique prompt
    const systemPrompt = `You are the ${from.toUpperCase()} analyst critiquing the ${target.toUpperCase()} analyst's memo.
Be professional but firm. Address their SPECIFIC claims with data.

Output EXACTLY this JSON schema:
{
  "from": "${from}",
  "target": "${target}",
  "critique": "200-400 word professional critique addressing their key points",
  "concessions": ["points where target is correct"],
  "strongest_counter": "your single strongest argument against their thesis",
  "data_needed": ["what additional data would resolve this disagreement"]
}`;

    const userPrompt = `
Context for ${ticker}:
${JSON.stringify(debate.context || {}, null, 2)}

${target.toUpperCase()} ANALYST'S MEMO TO CRITIQUE:
${JSON.stringify(targetAgent, null, 2)}

Your original ${from.toUpperCase()} memo:
${JSON.stringify(fromAgent, null, 2)}

Write your professional critique.`;

    // Call DeepSeek
    const response = await fetch(`${DEEPSEEK_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { ok: false, error: `DeepSeek API error: ${response.status}` },
        { status: 500 }
      );
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return NextResponse.json(
        { ok: false, error: 'Empty response from DeepSeek' },
        { status: 500 }
      );
    }
    
    let critique;
    try {
      critique = JSON.parse(content);
    } catch (parseError) {
      return NextResponse.json(
        { ok: false, error: `Failed to parse DeepSeek response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}` },
        { status: 500 }
      );
    }
    
    // Append to debate file
    if (!debate.cross_exam) {
      debate.cross_exam = [];
    }
    
    debate.cross_exam.push({
      ts: new Date().toISOString(),
      from,
      target,
      payload: critique
    });
    
    await fs.writeFile(debatePath, JSON.stringify(debate, null, 2));
    
    // Append to logs
    const logsPath = path.join(runsDir, 'logs.txt');
    const logLine = `[${new Date().toISOString()}] [${ticker}] Cross-exam: ${from} critiques ${target}\n`;
    await fs.appendFile(logsPath, logLine).catch(() => {});
    
    return NextResponse.json({
      ok: true,
      critique
    });
    
  } catch (error) {
    console.error('Cross-exam error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
