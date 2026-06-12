import type { TableProps } from 'antd';

/** 与 Cloudmap `VmSection` 列表一致：global-new.css 的 `.std-table` + 无底框全表线 */
export const csmStdTableLayoutProps: Pick<TableProps<unknown>, 'className' | 'bordered'> = {
  className: 'std-table',
  bordered: false,
};

export const csmListPagination = {
  size: 'small' as const,
  showTotal: (total: number) => `共 ${total} 条`,
};
