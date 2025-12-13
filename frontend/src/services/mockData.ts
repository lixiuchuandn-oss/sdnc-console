// 模拟数据文件，集中管理所有页面的模拟数据

// ===== 基础接口定义 =====
export interface BaseItem {
  id: string;
  name: string;
  type: string;
  status: string;
}



// ===== 模型与数据集模拟数据 =====
export interface Model extends BaseItem {
  source?: string;
  createTime?: string;
  description?: string;
  version?: string;
  size?: string;
  framework?: string;
}

export interface Dataset extends BaseItem {
  createTime?: string;
  description?: string;
  size?: string;
  source?: string;
}

export const mockModels: Model[] = [];
export const mockDatasets: Dataset[] = [];