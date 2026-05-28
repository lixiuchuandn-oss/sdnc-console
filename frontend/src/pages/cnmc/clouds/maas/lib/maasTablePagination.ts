import type { TablePaginationConfig } from 'antd/es/table';

/** MAAS 列表表分页（对齐 VmSection：pagination.size small + showTotal） */
export const MAAS_LIST_TABLE_PAGINATION: TablePaginationConfig = {
  size: 'small',
  pageSize: 20,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
};
