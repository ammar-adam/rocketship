import React from 'react';
import styles from './Badge.module.css';

interface BadgeProps {
  children: React.ReactNode;
  variant?:
    | 'neutral'
    | 'info'
    | 'success'
    | 'warn'
    | 'danger'
    | 'default'
    | 'warning'
    | 'error'
    | 'buy'
    | 'hold'
    | 'wait';
  size?: 'sm' | 'md';
  className?: string;
}

const VARIANT_MAP: Record<string, string> = {
  default: 'neutral',
  warning: 'warn',
  error: 'danger'
};

export function Badge({ children, variant = 'neutral', size = 'md', className = '' }: BadgeProps) {
  const normalized = VARIANT_MAP[variant] || variant;
  return (
    <span className={`${styles.badge} ${styles[normalized]} ${styles[size]} ${className}`}>
      {children}
    </span>
  );
}
