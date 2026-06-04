import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Input, Table, Tag, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { fetchCsmTenants } from '../../../../../services/api';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';
import { extractCsmApiItems, formatCsmTimestamp } from '../utils/csmApiItems';

type Props = {
  cloudId: string;
};

const lockStatusLabel = (v: unknown) => {
  const n = Number(v);
  if (n === 0) return { text: '锁定', color: 'red' as const };
  if (n === 1) return { text: '正常', color: 'green' as const };
  return { text: v != null && String(v).trim() !== '' ? String(v) : '-', color: 'default' as const };
};

/** CSM 池详情 — 从 CSM API 拉取租户 */
const CsmPoolTenantsSection: React.FC<Props> = ({ cloudId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCsmTenants(cloudId);
      setItems(extractCsmApiItems(res));
    } catch (e: any) {
      message.error(e?.message || 'CSM 租户查询失败');
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
      const fields = [row?.orgName, row?.orgId, row?.username, row?.accountName, row?.email, row?.phone];
      return fields.some((f) => String(f || '').toLowerCase().includes(q));
    });
  }, [items, keyword]);

  const columns = useMemo(
    () => [
      {
        title: '租户名称',
        dataIndex: 'orgName',
        key: 'orgName',
        fixed: 'left' as const,
        ellipsis: true,
        render: (v: unknown, row: any) => {
          const name = v != null && String(v).trim() !== '' ? String(v) : '';
          return name || row?.accountName || '-';
        },
      },
      {
        title: '组织 ID',
        dataIndex: 'orgId',
        key: 'orgId',
        ellipsis: true,
        render: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : '-'),
      },
      {
        title: '账号',
        dataIndex: 'username',
        key: 'username',
        ellipsis: true,
        render: (v: unknown, row: any) => {
          const u = v != null && String(v).trim() !== '' ? String(v) : '';
          return u || row?.accountName || '-';
        },
      },
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        ellipsis: true,
        render: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : '-'),
      },
      {
        title: '手机',
        dataIndex: 'phone',
        key: 'phone',
        render: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : '-'),
      },
      {
        title: '状态',
        dataIndex: 'lockStatus',
        key: 'lockStatus',
        render: (v: unknown) => {
          const { text, color } = lockStatusLabel(v);
          return text === '-' ? text : <Tag color={color}>{text}</Tag>;
        },
      },
      {
        title: '创建时间',
        dataIndex: 'createTime',
        key: 'createTime',
        render: (v: unknown) => formatCsmTimestamp(v),
      },
    ],
    [],
  );

  return (
    <PageDetailSection
      title="租户"
      onRefresh={() => {
        void load();
      }}
      toolbarLeft={
        <Input
          className="toolbar-search"
          allowClear
          placeholder="搜索租户名称、组织 ID、账号"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      }
    >
      <Table
        {...csmStdTableLayoutProps}
        loading={loading}
        rowKey={(row) => String(row?.orgId ?? row?.username ?? row?.orgName ?? JSON.stringify(row))}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: true }}
        pagination={csmListPagination}
        locale={{ emptyText: 'CSM 未返回租户数据' }}
      />
    </PageDetailSection>
  );
};

export default CsmPoolTenantsSection;
