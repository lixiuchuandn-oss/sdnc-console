import type { Key } from 'react';

export const getColumnOptions = (columns: any[]) =>
  columns
    .filter((c: any) => c.key !== 'action')
    .map((c: any) => ({ label: c.title, value: c.key }));

export const getDisplayColumns = (columns: any[], visibleKeys: string[]) => {
  const keys = new Set(visibleKeys);
  return columns.filter((c: any) => c.key === 'action' || keys.has(c.key));
};

export const createRowSelection = (
  selectedRowKeys: Key[],
  onChange: (keys: Key[]) => void,
  extraProps?: any,
) => ({
  selectedRowKeys,
  onChange,
  ...extraProps,
});
