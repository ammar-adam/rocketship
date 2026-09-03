import React from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

/**
 * The app's button.
 *
 * It previously had none, so every call site hand-rolled one - including the
 * primary "Run Full Debate" CTA, which was styled inline against
 * `var(--color-accent)`, `var(--color-negative)` and `var(--color-muted)`.
 * None of those tokens exist; the real names are --color-accent-base,
 * --color-error and --color-fg-muted. An undefined custom property with no
 * fallback resolves to nothing, so that button rendered with a transparent
 * background and `color: white` - white text on a white page.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${styles.btn} ${styles[variant]} ${styles[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
