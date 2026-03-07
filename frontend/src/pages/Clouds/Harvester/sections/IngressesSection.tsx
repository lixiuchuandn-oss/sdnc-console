/**
 * Harvester - Ingress 路由列表 Section
 * 用于展示集群中的 Ingress 资源，
 * 将各条规则聚合为可读的“host -> path”描述，并支持关键字过滤与手动刷新。
 */
import React, { useMemo, useState } from 'react';
import { Table, Tag, Button, message, Input } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID（当前实现尚未直接使用，预留后续扩展）
 * - ingresses: Ingress 列表，可能为原始对象或带 rawData 的包装对象
 * - loading: 外部传入的加载状态
 * - onRefresh: 手动刷新回调，支持传入 force=true
 */
interface Props {
  cloudId: string;
  ingresses: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const IngressesSection: React.FC<Props> = ({ cloudId, ingresses, loading, onRefresh }) => {
  // 关键字搜索（名称 / 命名空间）
  const [keyword, setKeyword] = useState<string>('');

  /**
   * 将原始 Ingress 对象转换为表格可直接展示的数据结构
   * - 规则字段会拼接为 “host -> [path1, path2]” 格式的简要描述
   */
  const dataSource = useMemo(() => {
    return (ingresses || []).map((i: any) => {
      const raw = i.rawData || i;
      const rules = raw.spec?.rules || [];
      const ruleDesc = rules.map((r: any) => {
        const host = r.host || '*';
        const paths = (r.http?.paths || []).map((p: any) => p.path).join(', ');
        return `${host} -> [${paths}]`;
      }).join('; ');

      return {
        key: raw.metadata?.uid || i.id,
        name: raw.metadata?.name || i.name,
        namespace: raw.metadata?.namespace || i.namespace,
        rules: ruleDesc,
        creationTimestamp: raw.metadata?.creationTimestamp || i.createdAt,
        raw,
      };
    });
  }, [ingresses]);

  /**
   * 简单关键字过滤逻辑
   * - 按名称或命名空间包含匹配
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  /**
   * 表格列定义
   * - 规则列采用 ellipsis 展示，内容较长时不影响整体表格宽度
   * - 操作列当前仅提供删除占位（实际删除能力未开放）
   */
  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '规则', dataIndex: 'rules', key: 'rules', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          buttonProps={{ className: 'row-actions-trigger' }}
          items={[
            { key: 'delete', label: '删除', danger: true, onClick: () => message.info('暂不支持删除') }
          ]}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            className="toolbar-search"
            placeholder="关键字"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            allowClear
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={
        <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}>刷新</Button>
      }
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />
    </PageDetailSection>
  );
};

export default IngressesSection;
