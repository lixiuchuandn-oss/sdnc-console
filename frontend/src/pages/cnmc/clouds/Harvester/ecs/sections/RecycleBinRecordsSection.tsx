/**
 * ==============================================================================
 * 模块名称: 回收站记录组件 (RecycleBinRecordsSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/sections/RecycleBinRecordsSection.tsx
 * ==============================================================================
 *
 * 展示回收站自动关机任务写入库表中的记录：
 * - 列表由后端按租户命名空间、云环境过滤；skipped 类记录不返回
 * ==============================================================================
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Table, Badge, Input, Button, Select, DatePicker, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { getRecycleBinShutdownRecords } from 'services/harvester/vm';
import { cnVmStatus } from '../../../../../../utils/harvesterUtils';
import dayjs, { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

interface Props {
  cloudId?: string;
}

interface ShutdownRecord {
  id: string;
  cloudId: string;
  cloudName: string;
  namespace: string;
  name: string;
  displayName?: string;
  instanceId: string;
  uid: string;
  shutdownAt: string;
  status: 'success' | 'failed' | 'skipped';
  errorMessage?: string;
  previousStatus?: string;
  taskId?: string;
}

const RecycleBinRecordsSection: React.FC<Props> = ({ cloudId }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ShutdownRecord[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });

  const pageSizeRef = useRef(pagination.pageSize);
  useEffect(() => {
    pageSizeRef.current = pagination.pageSize;
  }, [pagination.pageSize]);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);

  const loadData = useCallback(
    async (page = 1, pageSizeArg?: number) => {
      const size = pageSizeArg !== undefined ? pageSizeArg : pageSizeRef.current;
      setLoading(true);
      try {
        const params: any = {
          page,
          pageSize: size,
        };

        if (cloudId) {
          params.cloudId = cloudId;
        }
        if (statusFilter) {
          params.status = statusFilter;
        }
        if (dateRange[0] && dateRange[1]) {
          params.startTime = dateRange[0].startOf('day').toISOString();
          params.endTime = dateRange[1].endOf('day').toISOString();
        }

        const res = await getRecycleBinShutdownRecords(params);

        const records = res?.data?.records || res?.records || [];
        const paginationData = res?.data?.pagination || res?.pagination || {};

        setData(records);
        setPagination({
          page: paginationData.page || page,
          pageSize: paginationData.pageSize || size,
          total: paginationData.total ?? 0,
          totalPages: paginationData.totalPages ?? 0,
        });
      } catch (e: any) {
        message.error(e?.message || '加载回收站记录失败');
        setData([]);
      } finally {
        setLoading(false);
      }
    },
    [cloudId, statusFilter, dateRange],
  );

  useEffect(() => {
    void loadData(1);
  }, [loadData]);

  const filteredData = useMemo(() => {
    if (!keyword) return data;

    const kw = keyword.toLowerCase();
    return data.filter((record) => {
      return (
        record.cloudName?.toLowerCase().includes(kw) ||
        record.displayName?.toLowerCase().includes(kw) ||
        record.name?.toLowerCase().includes(kw) ||
        record.namespace?.toLowerCase().includes(kw) ||
        record.instanceId?.toLowerCase().includes(kw)
      );
    });
  }, [data, keyword]);

  const columns: ColumnsType<ShutdownRecord> = [
    {
      title: '命名空间',
      key: 'namespace',
      dataIndex: 'namespace',
      ellipsis: true,
    },
    {
      title: '云主机名称',
      key: 'name',
      dataIndex: 'name',
      ellipsis: true,
      render: (name: string, record: ShutdownRecord) => {
        return record.displayName || name;
      },
    },
    {
      title: '云主机ID',
      key: 'instanceId',
      dataIndex: 'instanceId',
      ellipsis: true,
    },
    {
      title: '关机时间',
      key: 'shutdownAt',
      dataIndex: 'shutdownAt',
      render: (time: string) => {
        if (!time) return '-';
        return dayjs(time).format('YYYY-MM-DD HH:mm:ss');
      },
      sorter: (a, b) => {
        const timeA = dayjs(a.shutdownAt).valueOf();
        const timeB = dayjs(b.shutdownAt).valueOf();
        return timeA - timeB;
      },
    },
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      render: (status: string) => {
        if (status === 'success') {
          return <Badge status="success" text="成功" />;
        }
        if (status === 'failed') {
          return <Badge status="error" text="失败" />;
        }
        return <Badge status="default" text={status || '-'} />;
      },
    },
    {
      title: '原状态',
      key: 'previousStatus',
      dataIndex: 'previousStatus',
      render: (previous: string) => (previous ? cnVmStatus(previous) : '-'),
    },
    {
      title: '错误信息',
      key: 'errorMessage',
      dataIndex: 'errorMessage',
      ellipsis: true,
      render: (msg: string) => {
        if (!msg) return '-';
        return <span style={{ color: '#ff4d4f' }}>{msg}</span>;
      },
    },
  ];

  const handleRefresh = () => {
    void loadData(pagination.page, pagination.pageSize);
  };

  const handleTableChange = (pag: { current?: number; pageSize?: number }) => {
    const nextPage = pag.current ?? 1;
    const nextSize = pag.pageSize ?? pageSizeRef.current;
    void loadData(nextPage, nextSize);
  };

  return (
    <PageDetailSection
      title="回收站记录"
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="云主机/实例ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(value) => setStatusFilter(value || '')}
            className="toolbar-filter-sm"
          >
            <Select.Option value="success">成功</Select.Option>
            <Select.Option value="failed">失败</Select.Option>
          </Select>
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [Dayjs | null, Dayjs | null])}
            format="YYYY-MM-DD"
            className="toolbar-filter"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('');
              setDateRange([null, null]);
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
        </div>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey="id"
        columns={columns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          pageSizeOptions: ['10', '20', '50', '100'],
        }}
        onChange={handleTableChange}
      />
    </PageDetailSection>
  );
};

export default RecycleBinRecordsSection;
