/**
 * ==============================================================================
 * 模块名称: 回收站记录组件 (RecycleBinRecordsSection)
 * 文件路径: frontend/src/pages/Clouds/Harvester/sections/RecycleBinRecordsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 展示回收站相关的任务记录，包括：
 * - 自动关机记录（当前实现）
 * - 自动删除记录（后续扩展）
 * 
 * [核心功能]
 * 1. 显示自动关机记录列表
 * 2. 支持筛选（云平台、状态、时间范围）
 * 3. 支持分页
 * 4. 显示详细信息（云平台、虚拟机、关机时间、状态、错误信息等）
 * 
 * ==============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Table, Badge, Input, Button, Select, DatePicker, Space, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../components/PageDetailSection';
import { getRecycleBinShutdownRecords } from '../../../../services/harvesterApi';
import dayjs, { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

interface Props {
  cloudId?: string; // 可选的云平台ID，用于筛选
}

interface ShutdownRecord {
  id: string;
  cloudId: string;
  cloudName: string;
  namespace: string;
  name: string;
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

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);

  /**
   * 加载数据
   */
  const loadData = async (page = 1) => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize: pagination.pageSize,
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
      console.log('[RecycleBinRecords] API 响应:', res);
      
      // 兼容不同的响应格式
      const records = res?.data?.records || res?.records || [];
      const paginationData = res?.data?.pagination || res?.pagination || {};

      console.log('[RecycleBinRecords] 解析后的记录数:', records.length);
      console.log('[RecycleBinRecords] 分页信息:', paginationData);

      setData(records);
      setPagination({
        page: paginationData.page || page,
        pageSize: paginationData.pageSize || 20,
        total: paginationData.total || 0,
        totalPages: paginationData.totalPages || 0,
      });
    } catch (e: any) {
      console.error('[RecycleBinRecords] 加载失败:', e);
      message.error(e?.message || '加载回收站记录失败');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    console.log('[RecycleBinRecords] 组件加载，cloudId:', cloudId);
    loadData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudId, statusFilter, dateRange]);

  // 筛选后的数据
  const filteredData = useMemo(() => {
    if (!keyword) return data;

    const kw = keyword.toLowerCase();
    return data.filter((record) => {
      return (
        record.cloudName?.toLowerCase().includes(kw) ||
        record.name?.toLowerCase().includes(kw) ||
        record.namespace?.toLowerCase().includes(kw) ||
        record.instanceId?.toLowerCase().includes(kw)
      );
    });
  }, [data, keyword]);

  // 表格列定义
  const columns: ColumnsType<ShutdownRecord> = [
    {
      title: '命名空间',
      key: 'namespace',
      dataIndex: 'namespace',
      ellipsis: true,
      width: 120,
    },
    {
      title: '虚拟机名称',
      key: 'name',
      dataIndex: 'name',
      ellipsis: true,
      width: 150,
    },
    {
      title: '实例ID',
      key: 'instanceId',
      dataIndex: 'instanceId',
      ellipsis: true,
      width: 200,
    },
    {
      title: '关机时间',
      key: 'shutdownAt',
      dataIndex: 'shutdownAt',
      width: 180,
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
      width: 100,
      render: (status: string) => {
        if (status === 'success') {
          return <Badge status="success" text="成功" />;
        } else if (status === 'failed') {
          return <Badge status="error" text="失败" />;
        } else if (status === 'skipped') {
          return <Badge status="default" text="跳过" />;
        }
        return <Badge status="default" text={status || '-'} />;
      },
      filters: [
        { text: '成功', value: 'success' },
        { text: '失败', value: 'failed' },
        { text: '跳过', value: 'skipped' },
      ],
      onFilter: (value, record) => record.status === value,
    },
    {
      title: '原状态',
      key: 'previousStatus',
      dataIndex: 'previousStatus',
      width: 100,
      render: (status: string) => status || '-',
    },
    {
      title: '错误信息',
      key: 'errorMessage',
      dataIndex: 'errorMessage',
      ellipsis: true,
      width: 200,
      render: (msg: string) => {
        if (!msg) return '-';
        return <span style={{ color: '#ff4d4f' }}>{msg}</span>;
      },
    },
  ];

  const handleRefresh = () => {
    loadData(pagination.page);
  };

  const handleTableChange = (newPagination: any) => {
    loadData(newPagination.current);
  };

  return (
    <PageDetailSection
      title="回收站记录"
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="关键字（云平台/虚拟机/命名空间）"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
            style={{ width: 250 }}
          />
          <Select
            placeholder="状态"
            allowClear
            value={statusFilter || undefined}
            onChange={(value) => setStatusFilter(value || '')}
            style={{ width: 120, marginLeft: 8 }}
          >
            <Select.Option value="success">成功</Select.Option>
            <Select.Option value="failed">失败</Select.Option>
            <Select.Option value="skipped">跳过</Select.Option>
          </Select>
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [Dayjs | null, Dayjs | null])}
            style={{ marginLeft: 8 }}
            format="YYYY-MM-DD"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('');
              setDateRange([null, null]);
            }}
            style={{ marginLeft: 8 }}
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
        bordered={false}
        rowKey="id"
        columns={columns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          size: 'small',
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        onChange={handleTableChange}
      />
    </PageDetailSection>
  );
};

export default RecycleBinRecordsSection;
