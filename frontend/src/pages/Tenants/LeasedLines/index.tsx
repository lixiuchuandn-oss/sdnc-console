import React, { useEffect, useState } from 'react';
import { Divider, Tabs } from 'antd';
import PageContainer from '../../../components/PageContainer';
import { useSearchParams } from 'react-router-dom';
import ListPage from './List';
import TasksPage from './Tasks';
import LogsPage from './Logs';
import '../../common/filters.css';

const TenantLeasedLinesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('list');
  const [startedTaskId, setStartedTaskId] = useState<string | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && ['list','tasks','logs'].includes(t) && t !== activeTab) {
      setActiveTab(t);
    }
  }, [searchParams, activeTab]);

  return (
    <PageContainer
      title="租户专线管理"
      titleLevel={3}
      subtitle="一站式管理租户专线IP；支持多维筛选/全列排序与批量操作；联动安全报告任务（进度跟踪、下载/取消/删除）；提供CSV导入与日志文件管理。"
      asCard={false}
    >
      <Tabs activeKey={activeTab} onChange={(key) => { setActiveTab(key); setSearchParams({ tab: key }); }}>
        <Tabs.TabPane tab="租户专线列表" key="list" />
        <Tabs.TabPane tab="安全报告任务" key="tasks" />
        <Tabs.TabPane tab="告警日志文件" key="logs" />
      </Tabs>

      {activeTab === 'list' && (
        <ListPage onStartTask={(id) => { setStartedTaskId(id); }} />
      )}

      {activeTab === 'tasks' && (
        <TasksPage startedTaskId={startedTaskId} onClearStartedTaskId={() => setStartedTaskId(undefined)} />
      )}

      {activeTab === 'logs' && (
        <LogsPage />
      )}
    </PageContainer>
  );
};

export default TenantLeasedLinesPage;
