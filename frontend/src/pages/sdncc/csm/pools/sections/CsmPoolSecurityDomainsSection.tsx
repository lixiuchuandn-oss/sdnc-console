import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Input, Table, Tag, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { fetchCsmSecurityDomains } from '../../../../../services/api';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';
import { extractCsmApiItems, formatCsmTimestamp } from '../utils/csmApiItems';

type Props = {
  cloudId: string;
};

const flowStatusLabel = (v: unknown) => {
  const n = Number(v);
  if (n === 1) return { text: '引流中', color: 'processing' as const };
  if (n === 0) return { text: '未引流', color: 'default' as const };
  return { text: v != null && String(v).trim() !== '' ? String(v) : '-', color: 'default' as const };
};

/** CSM 池详情 — 从 CSM API 拉取 CSM 安全域 */
const CsmPoolSecurityDomainsSection: React.FC<Props> = ({ cloudId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCsmSecurityDomains(cloudId);
      setItems(extractCsmApiItems(res));
    } catch (e: any) {
      message.error(e?.message || 'CSM 安全域查询失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const fields = [
        row?.name,
        row?.id,
        row?.orgName,
        row?.orgId,
        row?.companyName,
        Array.isArray(row?.networkCidrs) ? row.networkCidrs.join(',') : '',
      ];
      return fields.some((f) => String(f || '').toLowerCase().includes(q));
    });
  }, [items, keyword]);

  const columns = useMemo(
    () => [
      {
        title: 'CSM 安全域名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left' as const,
        ellipsis: true,
        render: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : '-'),
      },
      {
        title: 'CSM 安全域 ID',
        dataIndex: 'id',
        key: 'id',
        ellipsis: true,
        render: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : '-'),
      },
      {
        title: '租户',
        dataIndex: 'orgName',
        key: 'orgName',
        ellipsis: true,
        render: (v: unknown, row: any) => {
          const name = v != null && String(v).trim() !== '' ? String(v) : '';
          const id = row?.orgId != null ? String(row.orgId) : '';
          if (name && id) return `${name} (${id})`;
          return name || id || '-';
        },
      },
      {
        title: '网段',
        dataIndex: 'networkCidrs',
        key: 'networkCidrs',
        ellipsis: true,
        render: (cidrs: unknown) => {
          if (!Array.isArray(cidrs) || !cidrs.length) return '-';
          return cidrs.map((c) => String(c)).join(', ');
        },
      },
      {
        title: '网段数量',
        dataIndex: 'networkAllNums',
        key: 'networkAllNums',
        render: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : '-'),
      },
      {
        title: '引流状态',
        dataIndex: 'flowStatus',
        key: 'flowStatus',
        render: (v: unknown) => {
          const { text, color } = flowStatusLabel(v);
          return text === '-' ? text : <Tag color={color}>{text}</Tag>;
        },
      },
      {
        title: '创建时间',
        dataIndex: 'createTime',
        key: 'createTime',
        render: (v: unknown) => formatCsmTimestamp(v),
      },
      {
        title: '更新时间',
        dataIndex: 'updateTime',
        key: 'updateTime',
        render: (v: unknown) => formatCsmTimestamp(v),
      },
    ],
    [],
  );

  return (
    <PageDetailSection
      title="CSM 安全域"
      onRefresh={() => {
        void load();
      }}
      toolbarLeft={
        <Input
          className="toolbar-search"
          allowClear
          placeholder="搜索名称、ID、租户、网段"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      }
    >
      <Table
        {...csmStdTableLayoutProps}
        loading={loading}
        rowKey={(row) => String(row?.id ?? row?.name ?? JSON.stringify(row))}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: true }}
        pagination={csmListPagination}
        locale={{ emptyText: 'CSM 未返回 CSM 安全域数据' }}
      />
    </PageDetailSection>
  );
};

export default CsmPoolSecurityDomainsSection;
