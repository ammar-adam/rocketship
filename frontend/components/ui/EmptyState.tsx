import Link from 'next/link';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  title: string;
  description?: string;
  primaryAction?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
}

export function EmptyState({ title, description, primaryAction, secondaryAction }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}
      <div className={styles.actions}>
        {primaryAction && (
          <Link className={styles.primary} href={primaryAction.href}>
            {primaryAction.label}
          </Link>
        )}
        {secondaryAction && (
          <Link className={styles.secondary} href={secondaryAction.href}>
            {secondaryAction.label}
          </Link>
        )}
      </div>
    </div>
  );
}
