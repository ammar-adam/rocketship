/**
 * DeepSeek model configuration - single source of truth for the frontend.
 *
 * The `deepseek-chat` alias was retired on 2026-07-24 15:59 UTC and now returns
 * an error rather than routing to V4. It was a shim for V4-Flash's NON-thinking
 * mode, so the replacement has to disable thinking explicitly: V4 turns it on by
 * default, reasoning tokens bill as output, and thinking changes the behaviour
 * these prompts were written against.
 *
 * Keep this in sync with DEEPSEEK_MODEL / DEEPSEEK_THINKING in backend/main.py.
 */
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

export const DEEPSEEK_THINKING = { type: 'disabled' } as const;
