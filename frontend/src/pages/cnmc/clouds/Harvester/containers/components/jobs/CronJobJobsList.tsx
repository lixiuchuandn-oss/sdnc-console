/**
 * CronJob 关联 Job 列表。
 */
import React, { useState, useEffect } from 'react';
import { Table, Alert, Spin, App } from 'antd';
import { fetchHarvesterCronJobJobs } from '../../../../../../../services/harvesterApi';
import { renderJobStatus, formatTime } from '../../lib/jobs/jobHelpers';

const CronJobJobsList: React.FC<{
  cloudId: string;
  cronjob: any;
}> = ({ cloudId, cronjob }) => {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (!cronjob) return;
    
    const loadJobs = async () => {
      setLoading(true);
      try {
        const result = await fetchHarvesterCronJobJobs(
          cloudId,
          cronjob.metadata.namespace,
          cronjob.metadata.name
        );
        setJobs(result?.data?.items || []);
      } catch (e: any) {
        message.error('加载关联 Job 失败');
      } finally {
        setLoading(false);
      }
    };

    loadJobs();
  }, [cloudId, cronjob, message]);

  if (loading) return <Spin />;
  
  if (jobs.length === 0) {
    return <Alert message="暂无关联的 Job" type="info" showIcon />;
  }

  return (
    <Table
      dataSource={jobs}
      rowKey={(r) => r.metadata?.name}
      columns={[
        { title: '名称', dataIndex: ['metadata', 'name'], key: 'name' },
        { title: '状态', key: 'status', render: (_, record) => renderJobStatus(record) },
        { title: '创建时间', dataIndex: ['metadata', 'creationTimestamp'], key: 'time', render: formatTime },
      ]}
      pagination={false}
    />
  );
};

export default CronJobJobsList;
