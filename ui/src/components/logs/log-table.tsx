'use client';

import { type ReactNode } from 'react';

export type RowType = 'command' | 'event' | 'heartbeat' | 'error' | 'trust' | 'pending' | 'applied' | 'failed';

interface Column<T> {
  key: string;
  header: string;
  width?: number | string;
  render: (row: T) => ReactNode;
}

interface LogTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowType?: (row: T) => RowType;
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  emptyMessage?: string;
}

export function LogTable<T>({
  columns,
  rows,
  getRowType,
  getRowKey,
  onRowClick,
  selectedKey,
  emptyMessage = 'No data yet.',
}: LogTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="l-empty">
        {emptyMessage}
      </div>
    );
  }

  return (
    <table className="l-table">
      <thead>
        <tr>
          <th style={{ width: 8 }} />
          {columns.map(col => (
            <th key={col.key} style={col.width ? { width: col.width } : undefined}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const key = getRowKey(row);
          const rowType = getRowType ? `t-${getRowType(row)}` : '';
          return (
            <tr
              key={key}
              className={`${rowType}${selectedKey === key ? ' row-selected' : ''}`}
              onClick={() => onRowClick?.(row)}
            >
              <td />
              {columns.map(col => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
