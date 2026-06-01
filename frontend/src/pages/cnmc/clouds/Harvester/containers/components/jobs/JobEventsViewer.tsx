/**
 * Job 与关联 Pod 状态事件列表。
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Table, Tag, Spin } from 'antd';
import { formatTime } from '../../lib/jobs/jobHelpers';

const JobEventsViewer: React.FC<{
  job: any;
  pods: any[];
}> = ({ job, pods }) => {
  const [jobEvents, setJobEvents] = useState<any[]>([]);
  const [podEvents, setPodEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!job) return;

    const loadEvents = async () => {
      setLoading(true);
      try {
        // 从 job 的 status.conditions 中提取事件信息
        const conditions = job.status?.conditions || [];
        const eventsFromConditions = conditions.map((c: any, idx: number) => ({
          key: `job-${idx}`,
          type: c.status === 'True' ? 'Normal' : 'Warning',
          reason: c.type,
          message: c.message || '-',
          count: 1,
          lastTimestamp: c.lastTransitionTime || c.lastProbeTime,
          source: 'Job',
        }));
        setJobEvents(eventsFromConditions);

        // 从 pods 的 status.conditions 中提取事件信息
        const allPodEvents: any[] = [];
        pods.forEach((pod, podIdx) => {
          const conditions = pod.status?.conditions || [];
          conditions.forEach((c: any, idx: number) => {
            allPodEvents.push({
              key: `pod-${podIdx}-${idx}`,
              type: c.status === 'True' ? 'Normal' : 'Warning',
              reason: c.type,
              message: c.message || '-',
              count: 1,
              lastTimestamp: c.lastTransitionTime || c.lastProbeTime,
              source: `Pod: ${pod.metadata.name}`,
            });
          });

          // 添加容器状态相关事件
          const containerStatuses = pod.status?.containerStatuses || [];
          containerStatuses.forEach((cs: any) => {
            if (cs.state?.waiting?.reason) {
              allPodEvents.push({
                key: `pod-${podIdx}-container-${cs.name}`,
                type: 'Warning',
                reason: cs.state.waiting.reason,
                message: cs.state.waiting.message || '-',
                count: cs.restartCount || 1,
                lastTimestamp: pod.status.startTime,
                source: `Pod: ${pod.metadata.name}/${cs.name}`,
              });
            }
            if (cs.state?.terminated?.reason) {
              allPodEvents.push({
                key: `pod-${podIdx}-term-${cs.name}`,
                type: cs.state.terminated.exitCode === 0 ? 'Normal' : 'Warning',
                reason: cs.state.terminated.reason,
                message: `Exit Code: ${cs.state.terminated.exitCode}`,
                count: 1,
                lastTimestamp: cs.state.terminated.finishedAt,
                source: `Pod: ${pod.metadata.name}/${cs.name}`,
              });
            }
          });
        });
        setPodEvents(allPodEvents);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [job, pods]);

  const allEvents = useMemo(() => {
    return [...jobEvents, ...podEvents].sort((a, b) => {
      const timeA = new Date(a.lastTimestamp || 0).getTime();
      const timeB = new Date(b.lastTimestamp || 0).getTime();
      return timeB - timeA; // 倒序
    });
  }, [jobEvents, podEvents]);

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v}</Tag>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 160,
      ellipsis: true,
    },
    {
      title: '消息',
      dataIndex: 'message',
      ellipsis: true,
      render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</span>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 200,
      ellipsis: true,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '时间',
      dataIndex: 'lastTimestamp',
      width: 180,
      render: formatTime,
    },
  ];

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 8, color: '#666', fontSize: 12 }}>
        显示 Job 和关联 Pod 的状态变更事件
      </div>
      <Table
        dataSource={allEvents}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '暂无事件' }}
        scroll={{ y: 'calc(100vh - 300px)' }}
      />
    </Spin>
  );
};

export default JobEventsViewer;
