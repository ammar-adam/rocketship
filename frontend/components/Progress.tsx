import styles from './Progress.module.css';

interface ProgressProps {
  done: number;
  total: number;
  message?: string;
}

export default function Progress({ done, total, message }: ProgressProps) {
  const percentage = total > 0 ? (done / total) * 100 : 0;
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>
          {done} / {total}
        </span>
        {message && (
          <span className={styles.message}>{message}</span>
        )}
      </div>
      <div className={styles.bar}>
        <div 
          className={styles.fill} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
