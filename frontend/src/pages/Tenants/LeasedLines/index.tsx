import React, { useEffect, useState } from 'react';
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
      titleLevel={3}
      asCard={false}
      tabList={[
        { key: 'list', tab: '租户专线列表' },
        { key: 'tasks', tab: '安全报告任务' },
        { key: 'logs', tab: '告警日志文件' }
      ]}
      tabActiveKey={activeTab}
      onTabChange={(key) => { setActiveTab(key); setSearchParams({ tab: key }); }}
    >
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
