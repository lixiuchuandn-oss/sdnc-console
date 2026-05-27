/**
 * Harbor 推送命令 Section
 * 
 * 参考 Harbor 原生设计，显示镜像推送命令。
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card, Select, Alert, Space, Typography, Collapse, message, Input } from 'antd';
import { 
  CloudUploadOutlined, 
  DockerOutlined,
  CodeOutlined,
  RocketOutlined,
  ClusterOutlined,
} from '@ant-design/icons';
import type { HarborRegistry, HarborProject } from '../types';
import { getHarborProjects } from '../shared/harborApi';

const { Text, Paragraph } = Typography;

interface Props {
  harbor: HarborRegistry;
}

const UploadSection: React.FC<Props> = ({ harbor }) => {
  const [projects, setProjects] = useState<HarborProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [repositoryName, setRepositoryName] = useState<string>('');
  const [tag, setTag] = useState<string>('latest');

  /**
   * 加载项目列表
   */
  const loadProjects = useCallback(async () => {
    try {
      const res = await getHarborProjects(harbor.id, { page: 1, pageSize: 100 });
      const list = Array.isArray(res) ? res : (res?.data || []);
      setProjects(list);
      if (list.length > 0 && !selectedProject) {
        setSelectedProject(list[0].name);
      }
    } catch (e: any) {
      console.warn('加载项目列表失败:', e);
    }
  }, [harbor.id, selectedProject]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  /**
   * 生成镜像地址
   */
  const getImageUrl = useCallback(() => {
    const repo = repositoryName || 'REPOSITORY';
    const t = tag || 'TAG';
    return `${harbor.url}/${selectedProject}/${repo}:${t}`;
  }, [harbor.url, selectedProject, repositoryName, tag]);

  /**
   * 渲染命令块
   */
  const renderCommandBlock = (title: string, command: string) => (
    <div style={{ marginBottom: 12 }}>
      <Text type="secondary">{title}</Text>
      <Paragraph
        copyable={{
          text: command,
          onCopy: () => message.success('已复制到剪贴板'),
        }}
        style={{
          backgroundColor: '#f5f5f5',
          padding: '8px 12px',
          borderRadius: 4,
          marginTop: 4,
          fontFamily: 'monospace',
          fontSize: 13,
          marginBottom: 0,
        }}
      >
        {command}
      </Paragraph>
    </div>
  );

  return (
    <div>
      <Alert
        message="推送镜像说明"
        description={
          <div>
            <p>Harbor 不支持直接上传镜像文件。请使用以下工具推送镜像：</p>
            <ul style={{ marginBottom: 0 }}>
              <li><strong>Docker</strong> - 标记并推送镜像</li>
              <li><strong>Podman</strong> - 直接推送镜像</li>
              <li><strong>Helm</strong> - 推送 Chart 包</li>
              <li><strong>CNAB</strong> - 推送 CNAB bundle</li>
            </ul>
          </div>
        }
        type="info"
        showIcon
        icon={<CloudUploadOutlined />}
        style={{ marginBottom: 16 }}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>项目</Text>
            <Select
              style={{ width: '100%' }}
              placeholder="选择项目"
              value={selectedProject}
              onChange={setSelectedProject}
              options={projects.map(p => ({ label: p.name, value: p.name }))}
            />
          </div>
          
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>仓库名称</Text>
            <Input
              placeholder="例如：my-image"
              value={repositoryName}
              onChange={(e) => setRepositoryName(e.target.value)}
            />
          </div>

          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>标签</Text>
            <Input
              placeholder="例如：latest"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </div>
        </Space>
      </Card>

      <Card title="推送命令" size="small">
        <Collapse
          defaultActiveKey={['docker']}
          expandIconPosition="end"
          items={[
            {
              key: 'docker',
              label: (
                <Space>
                  <DockerOutlined />
                  <Text strong>Docker 推送命令</Text>
                </Space>
              ),
              children: (
                <div>
                  {renderCommandBlock(
                    '在项目中标记镜像：',
                    `docker tag SOURCE_IMAGE[:TAG] ${getImageUrl()}`
                  )}
                  {renderCommandBlock(
                    '推送镜像到当前项目：',
                    `docker push ${getImageUrl()}`
                  )}
                </div>
              ),
            },
            {
              key: 'podman',
              label: (
                <Space>
                  <CodeOutlined />
                  <Text strong>Podman 推送命令</Text>
                </Space>
              ),
              children: (
                <div>
                  {renderCommandBlock(
                    '推送镜像到当前项目：',
                    `podman push IMAGE_ID ${getImageUrl()}`
                  )}
                </div>
              ),
            },
            {
              key: 'helm',
              label: (
                <Space>
                  <RocketOutlined />
                  <Text strong>Helm 推送命令</Text>
                </Space>
              ),
              children: (
                <div>
                  {renderCommandBlock(
                    '在项目中打包 chart：',
                    `helm package CHART_PATH`
                  )}
                  {renderCommandBlock(
                    '推送 chart 到当前项目：',
                    `helm push CHART_PACKAGE oci://${harbor.url}/${selectedProject}`
                  )}
                </div>
              ),
            },
            {
              key: 'cnab',
              label: (
                <Space>
                  <ClusterOutlined />
                  <Text strong>CNAB 推送命令</Text>
                </Space>
              ),
              children: (
                <div>
                  {renderCommandBlock(
                    '推送 CNAB 到当前项目：',
                    `cnab-to-oci push CNAB_PATH --target ${getImageUrl()} --auto-update-bundle`
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Alert
        message="登录提示"
        description={
          <div>
            <p>推送镜像前请先登录 Harbor：</p>
            <Paragraph
              copyable={{
                text: `docker login ${harbor.url}`,
                onCopy: () => message.success('已复制到剪贴板'),
              }}
              style={{
                backgroundColor: '#f5f5f5',
                padding: '8px 12px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            >
              docker login {harbor.url}
            </Paragraph>
            <p style={{ marginTop: 8, marginBottom: 0 }}>使用 Harbor 用户名和密码进行登录</p>
          </div>
        }
        type="warning"
        showIcon
        style={{ marginTop: 16 }}
      />
    </div>
  );
};

export default UploadSection;