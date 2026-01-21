import React from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circular' | 'rectangular';
  className?: string;
}

export function Skeleton({ width, height, variant = 'text', className = '' }: SkeletonProps) {
  return (
    <div
      className={`${styles.skeleton} ${styles[variant]} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`${styles.card} ${className}`}>
      <Skeleton width="60%" height={20} />
      <Skeleton width="100%" height={60} className={styles.mt2} />
      <Skeleton width="80%" height={16} className={styles.mt2} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`${styles.table} ${className}`}>
      <div className={styles.tableHeader}>
        {Array(cols).fill(0).map((_, i) => (
          <Skeleton key={i} width="80%" height={16} />
        ))}
      </div>
      {Array(rows).fill(0).map((_, row) => (
        <div key={row} className={styles.tableRow}>
          {Array(cols).fill(0).map((_, col) => (
            <Skeleton key={col} width="70%" height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}
