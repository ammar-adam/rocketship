import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import styles from './ChartCard.module.css';

interface ChartCardProps {
  title: string;
  tooltip?: string;
  children: React.ReactNode;
}

export function ChartCard({ title, tooltip, children }: ChartCardProps) {
  return (
    <Card>
      <CardHeader className={styles.header}>
        <CardTitle>{title}</CardTitle>
        {tooltip && <span className={styles.tooltip} title={tooltip} aria-label={tooltip}>ⓘ</span>}
      </CardHeader>
      <CardContent className={styles.content}>{children}</CardContent>
    </Card>
  );
}
