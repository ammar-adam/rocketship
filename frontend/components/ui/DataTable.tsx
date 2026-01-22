import React from 'react';
import styles from './DataTable.module.css';

type Align = 'left' | 'right' | 'center';

interface Column<T> {
  key: keyof T | string;
  label: string;
  align?: Align;
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T;
  onRowClick?: (row: T) => void;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  onRowClick
}: DataTableProps<T>) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={String(col.key)} className={styles[`align_${col.align || 'left'}`]}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={String(row[rowKey])}
              className={onRowClick ? styles.clickable : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => {
                const value = row[col.key as keyof T];
                return (
                  <td key={String(col.key)} className={styles[`align_${col.align || 'left'}`]}>
                    {col.render ? col.render(value, row) : (value as React.ReactNode)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
