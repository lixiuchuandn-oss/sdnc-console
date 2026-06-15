import React from 'react';
import { Alert } from 'antd';

import YamlEditor from '../../../../../../../components/YamlEditor';

export interface WorkloadFormYamlPanelProps {
  yamlContent: string;
  yamlError: string | null;
  onYamlChange: (value: string) => void;
}

const WorkloadFormYamlPanel: React.FC<WorkloadFormYamlPanelProps> = ({
  yamlContent,
  yamlError,
  onYamlChange,
}) => (
  <div>
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="YAML 编辑模式"
      description="直接编辑 Kubernetes 资源定义，支持完整的 K8s API 规范。"
    />

    {yamlError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={yamlError} />}

    <YamlEditor value={yamlContent} onChange={onYamlChange} minHeight={400} maxHeight={600} />
  </div>
);

export default WorkloadFormYamlPanel;
