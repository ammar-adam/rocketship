import styles from './KpiTiles.module.css';

interface KpiItem {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'success' | 'warn' | 'danger';
}

interface KpiTilesProps {
  items: KpiItem[];
}

export function KpiTiles({ items }: KpiTilesProps) {
  return (
    <div className={styles.grid}>
      {items.map((kpi, idx) => (
        <div key={`${kpi.label}-${idx}`} className={`${styles.tile} ${styles[`tone_${kpi.tone || 'neutral'}`]}`}>
          <span className={styles.value}>{kpi.value}</span>
          <span className={styles.label}>{kpi.label}</span>
        </div>
      ))}
    </div>
  );
}
