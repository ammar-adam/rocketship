/**
 * Input Validation Utilities
 *
 * Schema-based validation for API inputs.
 * Provides strict type checking and sanitization.
 */

// Simple validation result type
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Validate a ticker symbol
 * Rules:
 * - 1-10 characters
 * - Uppercase letters, digits, dots, hyphens allowed
 * - Must start with a letter
 */
export function validateTicker(ticker: unknown): ValidationResult<string> {
  if (typeof ticker !== 'string') {
    return { success: false, error: 'Ticker must be a string' };
  }

  const normalized = ticker.toUpperCase().trim();

  if (normalized.length === 0) {
    return { success: false, error: 'Ticker cannot be empty' };
  }

  if (normalized.length > 10) {
    return { success: false, error: 'Ticker too long (max 10 characters)' };
  }

  if (!/^[A-Z][A-Z0-9.-]*$/.test(normalized)) {
    return { success: false, error: 'Invalid ticker format. Must start with a letter and contain only A-Z, 0-9, ., -' };
  }

  return { success: true, data: normalized };
}

/**
 * Validate an array of tickers
 */
export function validateTickerArray(
  tickers: unknown,
  options: { minLength?: number; maxLength?: number } = {}
): ValidationResult<string[]> {
  const { minLength = 0, maxLength = 500 } = options;

  if (!Array.isArray(tickers)) {
    return { success: false, error: 'Tickers must be an array' };
  }

  if (tickers.length < minLength) {
    return { success: false, error: `At least ${minLength} tickers required` };
  }

  if (tickers.length > maxLength) {
    return { success: false, error: `Maximum ${maxLength} tickers allowed` };
  }

  const validTickers: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < tickers.length; i++) {
    const result = validateTicker(tickers[i]);
    if (result.success && result.data) {
      validTickers.push(result.data);
    } else {
      errors.push(`[${i}]: ${result.error}`);
    }
  }

  if (errors.length > 0) {
    return { success: false, error: `Invalid tickers: ${errors.slice(0, 5).join(', ')}` };
  }

  return { success: true, data: validTickers };
}

/**
 * Validate a run ID
 * Format: YYYYMMDD_HHMMSS or test_[word]
 */
export function validateRunId(runId: unknown): ValidationResult<string> {
  if (typeof runId !== 'string') {
    return { success: false, error: 'Run ID must be a string' };
  }

  const trimmed = runId.trim();

  if (!/^(\d{8}_\d{6}|test_\w+)$/.test(trimmed)) {
    return { success: false, error: 'Invalid run ID format' };
  }

  return { success: true, data: trimmed };
}

/**
 * Validate optimization parameters
 */
export interface OptimizeParams {
  capital: number;
  max_weight: number;
  sector_cap: number;
  min_positions: number;
  max_positions: number;
}

export function validateOptimizeParams(body: unknown): ValidationResult<OptimizeParams> {
  const params = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const capital = typeof params.capital === 'number' ? params.capital : 10000;
  const max_weight = typeof params.max_weight === 'number' ? params.max_weight : 0.12;
  const sector_cap = typeof params.sector_cap === 'number' ? params.sector_cap : 0.35;
  const min_positions = typeof params.min_positions === 'number' ? params.min_positions : 8;
  const max_positions = typeof params.max_positions === 'number' ? params.max_positions : 25;

  // Validate ranges
  if (capital < 100 || capital > 10000000) {
    return { success: false, error: 'Capital must be between $100 and $10,000,000' };
  }

  if (max_weight < 0.01 || max_weight > 1) {
    return { success: false, error: 'Max weight must be between 0.01 and 1.0' };
  }

  if (sector_cap < 0.1 || sector_cap > 1) {
    return { success: false, error: 'Sector cap must be between 0.1 and 1.0' };
  }

  if (min_positions < 1 || min_positions > 100) {
    return { success: false, error: 'Min positions must be between 1 and 100' };
  }

  if (max_positions < min_positions || max_positions > 200) {
    return { success: false, error: 'Max positions must be >= min positions and <= 200' };
  }

  return {
    success: true,
    data: { capital, max_weight, sector_cap, min_positions, max_positions }
  };
}

/**
 * Validate debate request body
 */
export interface DebateRequestParams {
  extras: string[];
}

export function validateDebateRequest(body: unknown): ValidationResult<DebateRequestParams> {
  if (typeof body !== 'object' || body === null) {
    return { success: true, data: { extras: [] } };
  }

  const params = body as Record<string, unknown>;
  let extras: string[] = [];

  if (Array.isArray(params.extras)) {
    const result = validateTickerArray(params.extras, { maxLength: 10 });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    extras = result.data || [];
  }

  return { success: true, data: { extras } };
}

/**
 * Validate cross-exam request
 */
export interface CrossExamParams {
  from: 'bull' | 'bear';
  target: 'bull' | 'bear';
}

export function validateCrossExamRequest(body: unknown): ValidationResult<CrossExamParams> {
  if (typeof body !== 'object' || body === null) {
    return { success: false, error: 'Request body required' };
  }

  const params = body as Record<string, unknown>;

  if (params.from !== 'bull' && params.from !== 'bear') {
    return { success: false, error: 'from must be "bull" or "bear"' };
  }

  if (params.target !== 'bull' && params.target !== 'bear') {
    return { success: false, error: 'target must be "bull" or "bear"' };
  }

  if (params.from === params.target) {
    return { success: false, error: 'from and target must be different' };
  }

  return {
    success: true,
    data: { from: params.from, target: params.target }
  };
}

/**
 * Sanitize a string for safe logging (no secrets)
 */
export function sanitizeForLog(str: string, maxLength: number = 200): string {
  // Remove potential secrets
  let sanitized = str
    .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***REDACTED***')
    .replace(/[a-zA-Z0-9]{32,}/g, '***KEY_REDACTED***')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer ***REDACTED***');

  // Truncate
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...';
  }

  return sanitized;
}

/**
 * Create validation error response
 */
export function validationErrorResponse(error: string): Response {
  return new Response(
    JSON.stringify({ error, type: 'validation_error' }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
