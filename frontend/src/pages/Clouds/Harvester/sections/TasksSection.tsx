/**
 * ==============================================================================
 * 模块名称: 任务记录组件 (TasksSection)
 * 文件路径: frontend/src/pages/Clouds/Harvester/sections/TasksSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 统一展示 Harvester 相关的任务记录，包括：
 * - 迁移记录：虚拟机迁移任务
 * - 回收站记录：回收站自动关机、自动删除等任务
 * 
 * [核心功能]
 * 1. 使用分段选择器（Segmented）切换不同类型的任务记录
 * 2. 根据选择显示对应的子组件
 * 
 * ==============================================================================
 */

import React, { useState } from 'react';
import { Segmented } from 'antd';
import MigrationsSection from './MigrationsSection';
import RecycleBinRecordsSection from './RecycleBinRecordsSection';

interface Props {
  cloudId: string;
}

type TaskType = 'migrations' | 'recycle-bin';

const TasksSection: React.FC<Props> = ({ cloudId }) => {
  const [activeTab, setActiveTab] = useState<TaskType>('migrations');

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={activeTab}
          onChange={(value) => setActiveTab(value as TaskType)}
          options={[
            { label: '迁移记录', value: 'migrations' },
            { label: '回收站记录', value: 'recycle-bin' },
          ]}
        />
      </div>

      {activeTab === 'migrations' && <MigrationsSection cloudId={cloudId} />}
      {activeTab === 'recycle-bin' && <RecycleBinRecordsSection cloudId={cloudId} />}
    </div>
  );
};

export default TasksSection;
