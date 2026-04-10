/**
 * 权限定义 Hook
 * 
 * 从后端 API 获取权限定义数据，提供统一的权限元数据访问接口
 */

import { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../services/api';

export interface PermissionDefinition {
  id: string;              // 权限ID，如 'clouds.ecs:read'
  name: string;            // 显示名称，如 '云主机'
  description: string;      // 描述
  platform: string;        // 平台，如 'CNMC'
  group: string;           // 分组，如 '资源池管理'、'资源控制台'（控制台权限子组）
  category: string;        // 分类
  verb: 'read' | 'write';  // 操作类型
  inherits?: string[];     // 继承的权限
}

interface PermissionDefinitionsResponse {
  permissions: PermissionDefinition[];
}

/**
 * 获取权限定义的 Hook
 * 
 * @returns 权限定义数据、加载状态、错误信息
 */
export function usePermissionDefinitions() {
  const [definitions, setDefinitions] = useState<PermissionDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDefinitions = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = (await apiRequest('/api/system/rbac/permissions', {
          enableCache: true,
        })) as PermissionDefinitionsResponse;
        
        if (mounted) {
          setDefinitions(response?.permissions || []);
        }
      } catch (err) {
        if (mounted) {
          console.error('加载权限定义失败:', err);
          setError(err instanceof Error ? err : new Error('加载权限定义失败'));
          setDefinitions([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadDefinitions();

    return () => {
      mounted = false;
    };
  }, []);

  // 构建权限ID到定义的映射（用于快速查找）
  const definitionMap = useMemo(() => {
    const map = new Map<string, PermissionDefinition>();
    definitions.forEach(def => {
      map.set(def.id, def);
    });
    return map;
  }, [definitions]);

  // 构建权限前缀到定义的映射（用于根据前缀查找）
  // 注意：一个前缀可能对应多个定义（read 和 write）
  const prefixMap = useMemo(() => {
    const map = new Map<string, PermissionDefinition[]>();
    definitions.forEach(def => {
      const prefix = def.id.split(':')[0];
      if (!map.has(prefix)) {
        map.set(prefix, []);
      }
      map.get(prefix)!.push(def);
    });
    return map;
  }, [definitions]);

  return {
    definitions,
    definitionMap,
    prefixMap,
    loading,
    error,
  };
}
