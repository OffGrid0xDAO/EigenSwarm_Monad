'use client';

import { useState, type ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** Show this column in mobile card view */
  mobileKey?: boolean;
  /** Label to show in mobile card view (defaults to header) */
  mobileLabel?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  getRowKey: (row: T) => string;
  /** Enable mobile card view below md breakpoint */
  mobileCardView?: boolean;
}

export function DataTable<T>({ columns, data, onRowClick, emptyMessage = 'No data', getRowKey, mobileCardView = false }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-txt-disabled">
        {emptyMessage}
      </div>
    );
  }

  const mobileColumns = columns.filter((c) => c.mobileKey);
  const showMobileCards = mobileCardView && mobileColumns.length > 0;

  return (
    <>
      {/* Mobile card view */}
      {showMobileCards && (
        <div className="md:hidden space-y-3 p-4">
          {data.map((row) => (
            <div
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`rounded-xl border border-border-subtle bg-bg-card p-4 space-y-2 ${onRowClick ? 'cursor-pointer active:bg-bg-elevated' : ''}`}
            >
              {mobileColumns.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-2">
                  <span className="text-caption text-txt-disabled uppercase tracking-wider">
                    {col.mobileLabel || col.header}
                  </span>
                  <span className="text-sm">{col.render(row)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Desktop table view */}
      <div className={`overflow-x-auto ${showMobileCards ? 'hidden md:block' : ''}`}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  className={`
                    ${col.sortable ? 'cursor-pointer hover:text-txt-primary select-none' : ''}
                    ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                  `}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="currentColor"
                        className={`transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`}
                      >
                        <path d="M5 7L1 3h8L5 7z" />
                      </svg>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : ''}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
