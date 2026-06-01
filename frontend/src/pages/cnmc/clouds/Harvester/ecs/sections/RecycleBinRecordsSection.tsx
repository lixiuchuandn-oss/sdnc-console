/**
 * 回收站自动关机任务记录（Tower 本机库表，非集群实时同步列表）。
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Table, Input, Button, Select, DatePicker, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';

import PageDetailSection from 'components/PageDetailSection';
import { getRecycleBinShutdownRecords } from 'services/harvester/vm';
import {
  filterShutdownRecordsByKeyword,
  type ShutdownRecord,
} from '../lib/recycleBinRecordsSectionUtils';
import { buildRecycleBinRecordsTableColumns } from '../lib/recycleBinRecordsTableColumns';

const { RangePicker } = DatePicker;

type Props = {
  cloudId?: string;
};

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
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);

  const columns = useMemo(() => buildRecycleBinRecordsTableColumns(), []);

  const loadData = useCallback(
    async (page = 1, pageSizeArg?: number) => {
      const size = pageSizeArg !== undefined ? pageSizeArg : pageSizeRef.current;
      setLoading(true);
      try {
        const params: Record<string, unknown> = {
          page,
          pageSize: size,
        };
        if (cloudId) params.cloudId = cloudId;
        if (statusFilter) params.status = statusFilter;
        if (dateRange[0] && dateRange[1]) {
          params.startTime = dateRange[0].startOf('day').toISOString();
          params.endTime = dateRange[1].endOf('day').toISOString();
        }

        const res = await getRecycleBinShutdownRecords(params);
        const records = (res?.data?.records || res?.records || []) as ShutdownRecord[];
        const paginationData = res?.data?.pagination || res?.pagination || {};

        setData(records);
        setPagination({
          page: paginationData.page || page,
          pageSize: paginationData.pageSize || size,
          total: paginationData.total ?? 0,
          totalPages: paginationData.totalPages ?? 0,
        });
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '加载回收站记录失败');
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

  const filteredData = useMemo(
    () => filterShutdownRecordsByKeyword(data, keyword),
    [data, keyword],
  );

  const handleRefresh = useCallback(() => {
    void loadData(pagination.page, pagination.pageSize);
  }, [loadData, pagination.page, pagination.pageSize]);

  const handleTableChange = (pag: { current?: number; pageSize?: number }) => {
    const nextPage = pag.current ?? 1;
    const nextSize = pag.pageSize ?? pageSizeRef.current;
    void loadData(nextPage, nextSize);
  };

  return (
    <PageDetailSection
      title="回收站记录"
      refreshLoading={loading}
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
