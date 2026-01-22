import styles from './PillFilters.module.css';

interface PillOption {
  label: string;
  value: string;
}

interface PillFiltersProps {
  options: PillOption[];
  value: string;
  onChange: (value: string) => void;
}

export function PillFilters({ options, value, onChange }: PillFiltersProps) {
  return (
    <div className={styles.pills} role="tablist" aria-label="Filters">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`${styles.pill} ${value === opt.value ? styles.active : ''}`}
          onClick={() => onChange(opt.value)}
          role="tab"
          aria-selected={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
