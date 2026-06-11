import { message } from 'antd';
import { translateKnownApiErrorMessage } from './k8sErrorMessages';

/**
 * API 错误类型定义
 */
export interface ApiError {
  status?: number;
  message: string;
  data?: any;
  response?: Response;
}

/** 与 requestManager 抛错一致：403 + body.code === MUST_CHANGE_PASSWORD */
export function isMustChangePasswordApiError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: number; responseData?: { code?: string } };
  return e.status === 403 && e.responseData?.code === 'MUST_CHANGE_PASSWORD';
}

/**
 * 统一错误处理工具
 * 
 * 用于统一处理 API 请求错误，提供友好的错误提示
 * 
 * @param error - 错误对象（可以是 Error、AxiosError、Fetch Response 等）
 * @param options - 配置选项
 * @returns 处理后的错误信息
 * 
 * @example
 * ```typescript
 * try {
 *   const data = await apiRequest('/api/clouds');
 * } catch (error) {
 *   handleApiError(error, { showMessage: true });
 * }
 * ```
 */
export const handleApiError = (
  error: any,
  options: {
    showMessage?: boolean; // 是否显示错误提示
    defaultMessage?: string; // 默认错误消息
    onError?: (error: ApiError) => void; // 自定义错误处理回调
  } = {}
): ApiError => {
  const { showMessage = true, defaultMessage = '操作失败，请稍后重试', onError } = options;

  let apiError: ApiError = {
    message: defaultMessage,
  };

  // 处理 Fetch API Response 错误（同步处理，因为 Response.json() 是异步的）
  // 注意：这种情况通常不会直接传入 Response，而是通过其他方式处理

  // 处理 Axios 错误
  if (error?.response) {
    const { status, data } = error.response;
    apiError.status = status;
    apiError.data = data;

    const parts: string[] = [];
    if (data?.message) parts.push(String(data.message));
    else if (data?.msg) parts.push(String(data.msg));
    if (typeof data?.error === 'string') parts.push(data.error);
    if (data?.error && typeof data.error === 'object') parts.push(JSON.stringify(data.error));
    const combined =
      parts.length > 0 ? parts.join(' ') : getStatusMessage(status);
    apiError.message = translateKnownApiErrorMessage(combined);
    
    // 特殊状态码处理
    handleSpecialStatus(status, apiError.message);
    
    if (showMessage) {
      message.error(apiError.message);
    }
    
    if (onError) {
      onError(apiError);
    }
    
    return apiError;
  }

  // 处理网络错误（请求发送但未收到响应）
  if (error?.request) {
    apiError.message = '网络错误，请检查网络连接';
    
    if (showMessage) {
      message.error(apiError.message);
    }
    
    if (onError) {
      onError(apiError);
    }
    
    return apiError;
  }

  // 处理普通 Error 对象
  if (error instanceof Error) {
    apiError.message = translateKnownApiErrorMessage(error.message || defaultMessage);
    
    if (showMessage) {
      message.error(apiError.message);
    }
    
    if (onError) {
      onError(apiError);
    }
    
    return apiError;
  }

  // 处理字符串错误
  if (typeof error === 'string') {
    apiError.message = translateKnownApiErrorMessage(error);
    
    if (showMessage) {
      message.error(apiError.message);
    }
    
    if (onError) {
      onError(apiError);
    }
    
    return apiError;
  }

  // 未知错误类型
  apiError.message = defaultMessage;
  
  if (showMessage) {
    message.error(apiError.message);
  }
  
  if (onError) {
    onError(apiError);
  }
  
  return apiError;
};

/**
 * 根据 HTTP 状态码返回默认错误消息
 */
const getStatusMessage = (status: number): string => {
  const statusMessages: Record<number, string> = {
    400: '请求参数错误',
    401: '未授权，请重新登录',
    403: '权限不足，无法访问',
    404: '请求的资源不存在',
    409: '资源冲突，请检查数据',
    422: '数据验证失败',
    429: '请求过于频繁，请稍后重试',
    500: '服务器内部错误，请稍后重试',
    502: '网关错误，请稍后重试',
    503: '服务暂时不可用，请稍后重试',
    504: '网关超时，请稍后重试',
  };

  return statusMessages[status] || `请求失败 (${status})`;
};

/**
 * 处理特殊状态码（如 401 需要跳转登录）
 */
const handleSpecialStatus = (status: number, message: string): void => {
  switch (status) {
    case 401:
      // 未授权，延迟跳转登录（给用户看到错误消息的时间）
      setTimeout(() => {
        const currentPath = window.location.pathname;
        if (!currentPath.includes('/login')) {
          window.location.href = '/admin/login';
        }
      }, 1500);
      break;
    
    case 403:
      // 权限不足，可以记录日志或发送到监控系统
      console.warn('[权限不足]', message);
      break;
    
    case 500:
    case 502:
    case 503:
    case 504:
      // 服务器错误，可以发送到监控系统
      console.error('[服务器错误]', message);
      break;
    
    default:
      break;
  }
};

/**
 * 静默处理错误（不显示消息）
 * 用于某些场景下需要捕获错误但不打扰用户
 * 
 * @example
 * ```typescript
 * try {
 *   await refreshData();
 * } catch (error) {
 *   handleApiErrorSilently(error);
 * }
 * ```
 */
export const handleApiErrorSilently = (error: any): ApiError => {
  return handleApiError(error, { showMessage: false });
};

/**
 * 自定义错误处理
 * 允许完全自定义错误处理逻辑
 * 
 * @example
 * ```typescript
 * try {
 *   await saveData();
 * } catch (error) {
 *   handleApiError(error, {
 *     onError: (apiError) => {
 *       // 自定义处理逻辑
 *       if (apiError.status === 409) {
 *         Modal.confirm({
 *           title: '数据冲突',
 *           content: '是否覆盖现有数据？',
 *           onOk: () => retryWithOverwrite(),
 *         });
 *       }
 *     },
 *   });
 * }
 * ```
 */
export const handleApiErrorWithCallback = (
  error: any,
  callback: (error: ApiError) => void
): ApiError => {
  return handleApiError(error, { showMessage: false, onError: callback });
};
