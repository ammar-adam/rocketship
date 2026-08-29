/**
 * DeepSeek model configuration - single source of truth for the frontend.
 *
 * `deepseek-chat` was announced for retirement on 2026-07-24. Verified
 * 2026-08-29: it still resolves and maps to deepseek-v4-flash in NON-thinking
 * mode. Pinned explicitly anyway - a deprecated alias is not a dependency worth
 * keeping.
 *
 * The real trap is `thinking`. Measured on a trivial health check,
 * deepseek-v4-flash with NO thinking parameter returned 64 reasoning tokens and
 * 64 output tokens, against 9 output and 0 reasoning with thinking disabled.
 * V4 enables reasoning by default and reasoning tokens bill as output, so a
 * naive rename would have multiplied cost and changed behaviour.
 *
 * Keep in sync with DEEPSEEK_MODEL / DEEPSEEK_THINKING in backend/main.py.
 */
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

export const DEEPSEEK_THINKING = { type: 'disabled' } as const;
