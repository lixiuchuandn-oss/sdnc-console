import React from 'react';
import { Alert, Card, Space, Tag } from 'antd';

import { VolumesEditor } from '../editors';
import type { WorkloadContainerFormValue } from '../types';
import type { VolumesEditorProps } from '../editors/VolumesEditor';

export interface WorkloadFormStepStorageProps {
  containers: WorkloadContainerFormValue[];
  activeContainerIndex: number;
  onSelectContainer: (index: number) => void;
  volumeRefreshKey: number;
  onVolumeRefresh: () => void;
  volumesEditorProps: Omit<VolumesEditorProps, 'refreshKey' | 'onVolumeChange'>;
}

const WorkloadFormStepStorage: React.FC<WorkloadFormStepStorageProps> = ({
  containers,
  activeContainerIndex,
  onSelectContainer,
  volumeRefreshKey,
  onVolumeRefresh,
  volumesEditorProps,
}) => (
  <div>
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="存储配置"
      description="先定义工作负载共享的存储卷，再为当前选中的容器配置卷挂载。卷定义共享，卷挂载属于当前容器。"
    />
    {containers.map((container, index) => {
      const isActive = index === activeContainerIndex;
      return (
        <Card
          key={`storage-container-${index}`}
          size="small"
          style={{
            marginBottom: 16,
            border: isActive ? '2px solid #1677ff' : '1px solid #f0f0f0',
          }}
          title={
            <Space>
              <Tag color={isActive ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
              <span style={{ fontWeight: 500 }}>
                {container.containerName || `container-${index + 1}`}
              </span>
            </Space>
          }
        >
          {isActive ? (
            <VolumesEditor
              {...volumesEditorProps}
              refreshKey={volumeRefreshKey}
              onVolumeChange={onVolumeRefresh}
            />
          ) : (
            <div
              onClick={() => onSelectContainer(index)}
              style={{ cursor: 'pointer', padding: '8px 0' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectContainer(index);
              }}
            >
              <div style={{ color: '#999' }}>点击切换到此容器</div>
            </div>
          )}
        </Card>
      );
    })}
  </div>
);

export default WorkloadFormStepStorage;
