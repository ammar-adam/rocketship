# RocketShip Security Documentation

## Overview

RocketShip implements multiple layers of security following OWASP best practices. This document describes the security measures in place and how to configure them properly.

## Security Architecture

### 1. Rate Limiting

All API endpoints are protected by IP-based rate limiting to prevent abuse:

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Heavy (debate, optimize) | 5 requests | 1 minute |
| Medium (run creation) | 10 requests | 1 minute |
| Light (status polling) | 60 requests | 1 minute |
| Debug endpoints | 20 requests | 1 minute |

**Implementation**: `frontend/src/lib/rateLimit.ts`

Rate limits return HTTP 429 with a `Retry-After` header.

### 2. Input Validation

All user inputs are validated using strict schema-based validation:

- **Ticker symbols**: Must match `/^[A-Z][A-Z0-9.-]*$/`, max 10 chars
- **Run IDs**: Must match `/^(\d{8}_\d{6}|test_\w+)$/`
- **Optimization parameters**: Range-checked (e.g., capital: $100-$10M)
- **Array inputs**: Length-limited (e.g., max 500 tickers)

**Implementation**: `frontend/src/lib/validation.ts`

### 3. Path Traversal Protection

All file access operations are protected against path traversal attacks:

```typescript
// Blocked patterns
if (path.includes('..') || path.startsWith('/')) {
  throw new Error('Invalid path');
}

// Resolved path must stay within runs directory
if (!resolvedPath.startsWith(runsDir)) {
  throw new Error('Access denied');
}
```

### 4. Security Headers

The following security headers are applied to all responses:

| Header | Value | Purpose |
|--------|-------|---------|
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | SAMEORIGIN | Prevent clickjacking |
| Referrer-Policy | strict-origin-when-cross-origin | Limit referrer leakage |
| X-XSS-Protection | 1; mode=block | Legacy XSS protection |
| Permissions-Policy | camera=(), microphone=(), geolocation=() | Disable sensitive APIs |

**Configuration**: `frontend/next.config.ts`

### 5. API Key Security

**Critical**: API keys must NEVER be exposed to the client.

- All API keys are read from environment variables on the server
- Keys are validated for minimum length (20+ chars)
- Placeholder values are blocked (e.g., "YOUR_KEY_HERE", "changeme")
- Keys are never logged (sanitized in log output)

**Required Environment Variables**:
```env
DEEPSEEK_API_KEY=sk-your-key-here  # DeepSeek API for LLM debate
NEWS_API_KEY=your-newsapi-key       # NewsAPI for news fetching
```

**Key Rotation**:
1. Generate new keys from provider dashboards
2. Update environment variables (local `.env.local` or Vercel dashboard)
3. Restart the server / redeploy
4. Revoke old keys from provider dashboards

### 6. Error Handling

Error responses are sanitized to prevent information disclosure:

- Stack traces are never sent to clients
- API keys are redacted from any error messages
- Generic error messages for unknown errors
- Detailed errors are logged server-side only

### 7. Process Security

Child processes (Python optimizer, RocketScore) are spawned securely:

- Arguments passed as arrays (no shell injection)
- Working directory restricted to repo root
- Output captured and logged (not executed)
- Environment sanitized before passing to child

## Configuration Checklist

### Local Development

1. Create `frontend/.env.local`:
   ```env
   DEEPSEEK_API_KEY=sk-your-actual-key
   NEWS_API_KEY=your-actual-key
   ```

2. Ensure `.env.local` is in `.gitignore` (it should be by default)

3. Never commit API keys to version control

### Vercel Deployment

1. Go to Vercel Project Settings → Environment Variables

2. Add the following variables:
   - `DEEPSEEK_API_KEY` (Secret)
   - `NEWS_API_KEY` (Secret)
   - `BLOB_READ_WRITE_TOKEN` (Secret, optional for blob storage)

3. Enable Vercel's Edge Network protection if available

4. Review Function Logs for any security warnings

## Security Best Practices

### DO:
- Rotate API keys regularly (every 90 days recommended)
- Monitor API usage for anomalies
- Keep dependencies updated (`npm audit`, `pip check`)
- Use HTTPS in production (Vercel handles this)
- Review logs for suspicious patterns

### DON'T:
- Commit API keys to version control
- Log sensitive data (keys, tokens, PII)
- Trust user input without validation
- Expose internal error details to clients
- Disable security headers

## Incident Response

If you suspect a security incident:

1. **Rotate all API keys immediately**
2. Check API provider dashboards for unauthorized usage
3. Review application logs for suspicious activity
4. If data breach suspected, assess what was exposed
5. Document and report according to your organization's policy

## Security Contact

For security vulnerabilities, please report responsibly:
- Do not open public GitHub issues for security bugs
- Contact the maintainers directly with details
- Allow reasonable time for fixes before disclosure

## Audit History

| Date | Type | Notes |
|------|------|-------|
| 2026-01-26 | Initial | Security hardening implemented |

---

*This document should be reviewed and updated regularly as the application evolves.*
