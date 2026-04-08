/**
 * ==============================================================================
 * 模块名称: YAML 编辑弹窗 (YamlEditModal)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/YamlEditModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 通用的 YAML 编辑弹窗组件，支持编辑 Kubernetes 资源的 YAML 配置。
 * 
 * [使用场景]
 * - 编辑 Service YAML
 * - 编辑 Ingress YAML
 * - 编辑其他 K8s 资源 YAML
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Space, App, Spin, Alert } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import YamlEditor from '../../../../../components/YamlEditor';

export interface YamlEditModalProps {
  visible: boolean;
  title: string;
  cloudId: string;
  namespace: string;
  name: string;
  resourceType: string; // 'service' | 'ingress' | etc.
  initialYaml?: string;
  onLoadYaml: () => Promise<string>; // 加载 YAML 内容
  onSaveYaml: (yaml: string) => Promise<void>; // 保存 YAML 内容
  onCancel: () => void;
  onSuccess: () => void;
}

const YamlEditModal: React.FC<YamlEditModalProps> = ({
  visible,
  title,
  cloudId,
  namespace,
  name,
  resourceType,
  initialYaml,
  onLoadYaml,
  onSaveYaml,
  onCancel,
  onSuccess,
}) => {
  const { message } = App.useApp();
  const [yamlContent, setYamlContent] = useState('');
  const [originalYaml, setOriginalYaml] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 加载 YAML 内容
  useEffect(() => {
    if (visible) {
      setLoading(true);
      onLoadYaml()
        .then((yaml) => {
          setYamlContent(yaml);
          setOriginalYaml(yaml);
        })
        .catch((err) => {
          message.error(`加载 YAML 失败: ${err?.message || '未知错误'}`);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [visible, onLoadYaml]);

  // 重置为原始内容
  const handleReset = () => {
    setYamlContent(originalYaml);
    message.info('已重置为原始内容');
  };

  // 保存 YAML
  const handleSave = async () => {
    if (!yamlContent.trim()) {
      message.error('YAML 内容不能为空');
      return;
    }

    // 简单的格式验证（同时支持 YAML 和 JSON 格式）
    // YAML: apiVersion: xxx  或  JSON: "apiVersion": "xxx"
    const hasApiVersion = yamlContent.includes('apiVersion') || yamlContent.includes('"apiVersion"');
    const hasKind = yamlContent.includes('kind') || yamlContent.includes('"kind"');
    
    if (!hasApiVersion || !hasKind) {
      message.error('格式错误：缺少 apiVersion 或 kind 字段');
      return;
    }

    setSaving(true);
    try {
      await onSaveYaml(yamlContent);
      message.success('保存成功');
      onSuccess();
    } catch (err: any) {
      message.error(`保存失败: ${err?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  // 检查是否有修改
  const hasChanges = yamlContent !== originalYaml;

  return (
    <Modal
      title={title}
      open={visible}
      onCancel={onCancel}
      width={800}
      footer={null}
      destroyOnClose
      maskClosable={false}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="加载中..." />
        </div>
      ) : (
        <>
          {hasChanges && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="内容已修改，请确保 YAML 格式正确后保存"
            />
          )}
          <YamlEditor
            value={yamlContent}
            onChange={(val: string) => setYamlContent(val)}
            placeholder="YAML 内容"
            minHeight={400}
            maxHeight={500}
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={handleReset} disabled={!hasChanges}>
                重置
              </Button>
              <Button onClick={onCancel}>取消</Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
                disabled={!hasChanges}
              >
                保存
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  );
};

export default YamlEditModal;
