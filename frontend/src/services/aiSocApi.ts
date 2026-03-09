import { apiRequest } from './api';

export const getAiSocBaseUrl = () => {
  return '/api/threats/proxy';
};

export interface AiThreatEvent {
  id: number;
  report_id: number;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  created_at: string;
  updated_at: string;
  tenant_id: number;
  start_time: string;
  end_time: string;
  attack_type: string;
  completed_at: string;
  report_url: string[];
  md_report: string;
  workflow_id: string | null;
  tenant_name: string;
  tenant_code: string;
  task_id: string;
  tname?: string;
  risk_level?: string | null;
}

export const fetchAiThreatEvents = async (tenantCode: string): Promise<AiThreatEvent[]> => {
  const baseUrl = getAiSocBaseUrl();
  const url = `${baseUrl}/api/v1/report-tasks/search/by-tenant?tenant_code=${encodeURIComponent(tenantCode)}`;

  try {
    const data = await apiRequest(url);
    
    // 处理不同的响应格式
    if (Array.isArray(data)) {
      return data;
    } else if (data && Array.isArray(data.data)) {
      return data.data;
    } else if (data && data.data && Array.isArray(data.data.items)) {
      return data.data.items;
    } else if (data && Array.isArray(data.items)) {
      return data.items;
    }
    return [];
  } catch (error) {
    console.error('Fetch AI threat events failed:', error);
    throw error;
  }
};
