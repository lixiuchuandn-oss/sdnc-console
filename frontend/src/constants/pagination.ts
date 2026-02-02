import { TablePaginationConfig } from 'antd/es/table';

/**
 * 全局统一的分页配置默认值
 * 用于所有 Table 组件的 pagination 属性
 */
export const DEFAULT_PAGINATION_CONFIG: TablePaginationConfig = {
  // 默认每页显示条数选项
  pageSizeOptions: ['10', '20', '50', '100'],
  // 默认显示每页条数切换器
  showSizeChanger: true,
  // 默认不显示快速跳转（根据 UI 规范）
  showQuickJumper: false,
  // 默认显示总数
  showTotal: (total: number) => `共 ${total} 条`,
  // 默认每页 10 条
  defaultPageSize: 10,
};

/**
 * 获取合并后的分页配置
 * @param customConfig 自定义配置（来自父组件或特定场景）
 * @returns 合并后的 Ant Design Pagination 配置对象
 */
export const getPaginationConfig = (customConfig?: TablePaginationConfig | false): TablePaginationConfig | false => {
  if (customConfig === false) return false;
  
  return {
    ...DEFAULT_PAGINATION_CONFIG,
    ...customConfig,
  };
};
