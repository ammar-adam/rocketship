'use client';

import React from 'react';
import styles from './FilterPills.module.css';

interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

interface FilterPillsProps {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function FilterPills({ options, value, onChange, className = '' }: FilterPillsProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          className={`${styles.pill} ${value === option.value ? styles.active : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className={styles.count}>{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
