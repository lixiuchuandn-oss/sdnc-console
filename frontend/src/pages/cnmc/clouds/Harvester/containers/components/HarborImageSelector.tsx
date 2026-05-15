/**
 * ==============================================================================
 * 模块名称: Harbor 镜像选择器组件 (HarborImageSelector)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/HarborImageSelector.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 从 Harbor 镜像仓库级联选择镜像：
 * 1. 选择 Harbor 实例
 * 2. 选择项目
 * 3. 选择仓库
 * 4. 选择标签
 * 
 * 选择完成后自动同步凭证到 K8s Secret
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Select, Spin, message, Space, Typography, Alert } from 'antd';
import { 
  DatabaseOutlined, 
  FolderOutlined, 
  AppstoreOutlined, 
  TagOutlined,
  CheckCircleOutlined 
} from '@ant-design/icons';
import { 
  getHarborRegistries, 
  getHarborSelectorProjects, 
  getHarborSelectorRepositories, 
  getHarborSelectorTags, 
  syncHarborSecret 
} from '../../../../../../services/harvesterApi';

const { Text } = Typography;

/**
 * Harbor 实例类型
 */
interface HarborRegistry {
  id: string;
  name: string;
  url: string;
  username?: string;
  insecure?: boolean;
}

/**
 * 组件属性接口
 */
export interface HarborImageSelectorProps {
  cloudId: string;
  namespace?: string;
  onSelect: (imageRef: string, secret?: string) => void;
}

/**
 * HarborImageSelector 组件
 */
const HarborImageSelector: React.FC<HarborImageSelectorProps> = ({
  cloudId,
  namespace = 'default',
  onSelect,
}) => {
  // Harbor 列表
  const [harbors, setHarbors] = useState<HarborRegistry[]>([]);
  const [selectedHarbor, setSelectedHarbor] = useState<string>();
  const [harborLoading, setHarborLoading] = useState(false);

  // 项目列表
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>();
  const [projectLoading, setProjectLoading] = useState(false);

  // 仓库列表
  const [repositories, setRepositories] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>();
  const [repoLoading, setRepoLoading] = useState(false);

  // 标签列表
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>();
  const [tagLoading, setTagLoading] = useState(false);

  // 同步状态
  const [syncing, setSyncing] = useState(false);

  // 加载 Harbor 列表
  useEffect(() => {
    loadHarbors();
  }, []);

  const loadHarbors = async () => {
    setHarborLoading(true);
    try {
      const res = await getHarborRegistries();
      const list = res?.data || res || [];
      setHarbors(Array.isArray(list) ? list : []);
    } catch (e: any) {
      message.error(e?.message || '加载 Harbor 列表失败');
      setHarbors([]);
    } finally {
      setHarborLoading(false);
    }
  };

  // 加载项目列表
  useEffect(() => {
    if (selectedHarbor) {
      loadProjects(selectedHarbor);
      // 重置下级选择
      setSelectedProject(undefined);
      setSelectedRepo(undefined);
      setSelectedTag(undefined);
      setProjects([]);
      setRepositories([]);
      setTags([]);
    }
  }, [selectedHarbor]);

  const loadProjects = async (harborId: string) => {
    setProjectLoading(true);
    try {
      const res = await getHarborSelectorProjects(harborId);
      const list = res?.data || res || [];
      // 后端返回对象数组 { name, projectId, repoCount }，提取 name 字段
      const names = Array.isArray(list) ? list.map((p: any) => p.name || p) : [];
      setProjects(names);
    } catch (e: any) {
      message.error(e?.message || '加载项目列表失败');
      setProjects([]);
    } finally {
      setProjectLoading(false);
    }
  };

  // 加载仓库列表
  useEffect(() => {
    if (selectedHarbor && selectedProject) {
      loadRepositories(selectedHarbor, selectedProject);
      // 重置下级选择
      setSelectedRepo(undefined);
      setSelectedTag(undefined);
      setRepositories([]);
      setTags([]);
    }
  }, [selectedHarbor, selectedProject]);

  const loadRepositories = async (harborId: string, project: string) => {
    setRepoLoading(true);
    try {
      const res = await getHarborSelectorRepositories(harborId, project);
      const list = res?.data || res || [];
      // 后端返回对象数组 { name, artifactCount, pullCount }，提取 name 字段
      const names = Array.isArray(list) ? list.map((r: any) => r.name || r) : [];
      setRepositories(names);
    } catch (e: any) {
      message.error(e?.message || '加载仓库列表失败');
      setRepositories([]);
    } finally {
      setRepoLoading(false);
    }
  };

  // 加载标签列表
  useEffect(() => {
    if (selectedHarbor && selectedProject && selectedRepo) {
      loadTags(selectedHarbor, selectedProject, selectedRepo);
      // 重置下级选择
      setSelectedTag(undefined);
      setTags([]);
    }
  }, [selectedHarbor, selectedProject, selectedRepo]);

  const loadTags = async (harborId: string, project: string, repo: string) => {
    setTagLoading(true);
    try {
      const res = await getHarborSelectorTags(harborId, project, repo);
      const list = res?.data || res || [];
      // 后端返回对象数组 { name, digest, pushTime, pullTime }，提取 name 字段
      const names = Array.isArray(list) ? list.map((t: any) => t.name || t) : [];
      setTags(names);
    } catch (e: any) {
      message.error(e?.message || '加载标签列表失败');
      setTags([]);
    } finally {
      setTagLoading(false);
    }
  };

  // 选择标签后自动确认
  const handleTagChange = useCallback(async (tag: string) => {
    setSelectedTag(tag);
    
    if (!selectedHarbor || !selectedProject || !selectedRepo || !tag) {
      return;
    }

    const harbor = harbors.find(h => h.id === selectedHarbor);
    if (!harbor) return;

    // 构建镜像引用
    // 移除 URL 中的协议前缀
    let harborUrl = harbor.url.replace(/^https?:\/\//, '');
    // 移除末尾的斜杠
    harborUrl = harborUrl.replace(/\/+$/, '');
    
    const imageRef = `${harborUrl}/${selectedProject}/${selectedRepo}:${tag}`;

    // 自动同步凭证到 K8s
    setSyncing(true);
    try {
      const syncRes = await syncHarborSecret(selectedHarbor, { cloudId, namespace });
      // API 返回格式: { data: { secretName: ... } }
      const secretName = syncRes?.data?.secretName;
      message.success('已同步镜像拉取凭证');
      onSelect(imageRef, secretName);
    } catch (e: any) {
      // 凭证同步失败，仍允许选择（可能已有凭证）
      console.warn('同步 Harbor 凭证失败:', e);
      onSelect(imageRef);
    } finally {
      setSyncing(false);
    }
  }, [selectedHarbor, selectedProject, selectedRepo, harbors, cloudId, namespace, onSelect]);

  // 计算选择的完整性
  const isComplete = selectedHarbor && selectedProject && selectedRepo && selectedTag;
  const currentHarbor = harbors.find(h => h.id === selectedHarbor);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 选择提示 */}
      <Alert
        type="info"
        showIcon
        message="从 Harbor 镜像仓库选择镜像，系统将自动同步拉取凭证"
        style={{ marginBottom: 8 }}
      />

      {/* Harbor 选择器 */}
      <div>
        <div style={{ marginBottom: 4 }}>
          <DatabaseOutlined style={{ marginRight: 6, color: '#1890ff' }} />
          <Text strong>Harbor 实例</Text>
        </div>
        <Select
          placeholder="选择 Harbor 实例"
          value={selectedHarbor}
          onChange={setSelectedHarbor}
          options={harbors.map(h => ({ 
            value: h.id, 
            label: `${h.name} (${h.url})` 
          }))}
          style={{ width: '100%' }}
          loading={harborLoading}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      {/* 项目选择器 */}
      <div>
        <div style={{ marginBottom: 4 }}>
          <FolderOutlined style={{ marginRight: 6, color: selectedHarbor ? '#52c41a' : '#d9d9d9' }} />
          <Text type={selectedHarbor ? undefined : 'secondary'}>项目</Text>
        </div>
        <Select
          placeholder={selectedHarbor ? "选择项目" : "请先选择 Harbor 实例"}
          value={selectedProject}
          onChange={setSelectedProject}
          options={projects.map(p => ({ value: p, label: p }))}
          style={{ width: '100%' }}
          loading={projectLoading}
          disabled={!selectedHarbor}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      {/* 仓库选择器 */}
      <div>
        <div style={{ marginBottom: 4 }}>
          <AppstoreOutlined style={{ marginRight: 6, color: selectedProject ? '#52c41a' : '#d9d9d9' }} />
          <Text type={selectedProject ? undefined : 'secondary'}>仓库</Text>
        </div>
        <Select
          placeholder={selectedProject ? "选择仓库" : "请先选择项目"}
          value={selectedRepo}
          onChange={setSelectedRepo}
          options={repositories.map(r => ({ value: r, label: r }))}
          style={{ width: '100%' }}
          loading={repoLoading}
          disabled={!selectedProject}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      {/* 标签选择器 */}
      <div>
        <div style={{ marginBottom: 4 }}>
          <TagOutlined style={{ marginRight: 6, color: selectedRepo ? '#52c41a' : '#d9d9d9' }} />
          <Text type={selectedRepo ? undefined : 'secondary'}>标签</Text>
        </div>
        <Select
          placeholder={selectedRepo ? "选择标签" : "请先选择仓库"}
          value={selectedTag}
          onChange={handleTagChange}
          options={tags.map(t => ({ value: t, label: t }))}
          style={{ width: '100%' }}
          loading={tagLoading}
          disabled={!selectedRepo}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      {/* 预览已选择的镜像 */}
      {isComplete && currentHarbor && (
        <div style={{ 
          padding: '12px 16px', 
          background: '#f6ffed', 
          border: '1px solid #b7eb8f',
          borderRadius: 6,
          marginTop: 8
        }}>
          <Space>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <Text strong>已选择镜像：</Text>
            <Text code>
              {currentHarbor.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
              /{selectedProject}/{selectedRepo}:{selectedTag}
            </Text>
          </Space>
        </div>
      )}

      {/* 同步状态 */}
      {syncing && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <Spin size="small" />
          <Text type="secondary" style={{ marginLeft: 8 }}>正在同步镜像拉取凭证...</Text>
        </div>
      )}
    </Space>
  );
};

export default HarborImageSelector;
