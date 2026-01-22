/**
 * Environment variable validation and access
 * All API keys must be validated at runtime
 */

export interface EnvConfig {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  newsApiKey: string;
}

export interface KeyInfo {
  hasKey: boolean;
  keyLen: number;
  keyPrefix: string;
}

function validateKey(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to frontend/.env.local and restart npm run dev`
    );
  }
  
  const trimmed = value.trim();
  
  // Check for placeholder values
  const placeholders = ['VALUE', 'changeme', 'your_key_here', 'YOUR_KEY_HERE', 'xxx', 'XXX'];
  if (placeholders.some(p => trimmed.toLowerCase().includes(p.toLowerCase()))) {
    throw new Error(
      `${name} appears to be a placeholder value. Set a real key in frontend/.env.local`
    );
  }
  
  // Check minimum length
  if (trimmed.length < 20) {
    throw new Error(
      `${name} is too short (${trimmed.length} chars). Expected at least 20 characters.`
    );
  }
  
  return trimmed;
}

export function getKeyInfo(value: string | undefined): KeyInfo {
  if (!value || value.trim().length === 0) {
    return { hasKey: false, keyLen: 0, keyPrefix: '' };
  }
  const trimmed = value.trim();
  return {
    hasKey: true,
    keyLen: trimmed.length,
    keyPrefix: trimmed.substring(0, 4)
  };
}

export function getEnvConfig(validate = true): EnvConfig {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const newsKey = process.env.NEWS_API_KEY;
  
  if (validate) {
    return {
      deepseekApiKey: validateKey(deepseekKey, 'DEEPSEEK_API_KEY'),
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      newsApiKey: validateKey(newsKey, 'NEWS_API_KEY')
    };
  }
  
  return {
    deepseekApiKey: deepseekKey || '',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    newsApiKey: newsKey || ''
  };
}

export function hasValidDeepSeekKey(): boolean {
  try {
    validateKey(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY');
    return true;
  } catch {
    return false;
  }
}

export function hasValidNewsApiKey(): boolean {
  try {
    validateKey(process.env.NEWS_API_KEY, 'NEWS_API_KEY');
    return true;
  } catch {
    return false;
  }
}
