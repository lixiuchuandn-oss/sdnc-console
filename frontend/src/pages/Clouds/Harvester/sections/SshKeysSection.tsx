/**
 * Harvester - SSH 密钥列表 Section
 * 展示 Harvester 中的 SSH Key 资源，
 * 支持：
 * - 按名称 / 命名空间关键字过滤
 * - 查看密钥指纹 Fingerprint
 * - 通过工具栏刷新数据
 * 当前仅提供删除占位操作（实际删除能力尚未开放）。
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID（预留给后续扩展 SSH Key 操作）
 * - sshKeys: SSH 密钥列表，可能为原始对象或带 rawData 的包装对象
 * - loading: 外层加载状态
 * - onRefresh: 刷新回调，支持 force=true
 */
interface Props {
  cloudId: string;
  sshKeys: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const SshKeysSection: React.FC<Props> = ({ cloudId, sshKeys, loading, onRefresh }) => {
  // 关键字搜索，仅用于前端过滤名称/命名空间
  const [keyword, setKeyword] = useState<string>('');
  
  /**
   * 将后端返回的 SSH Key 数据统一转换为表格可用结构
   * - 优先读取 rawData.metadata 下的 K8s 字段
   * - 指纹从 status.fingerprint / k.fingerprint 兜底
   */
  const dataSource = useMemo(() => {
    return (sshKeys || []).map((k: any) => {
      const raw = k.rawData || k;
      return {
        key: raw.metadata?.uid || k.id,
        name: raw.metadata?.name || k.name,
        namespace: raw.metadata?.namespace || k.namespace,
        fingerprint: raw.status?.fingerprint || k.fingerprint || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || k.createdAt,
        raw,
      };
    });
  }, [sshKeys]);

  /**
   * 前端过滤逻辑
   * - 关键字：匹配名称/命名空间
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
   * - 名称列使用 cell-link 样式，后续可扩展点击查看详情
   * - 操作列暂时仅提供删除占位提示
   */
  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', className: 'cell-link' },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '指纹 (Fingerprint)', dataIndex: 'fingerprint', key: 'fingerprint', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180, className: 'std-time' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            { key: 'delete', label: '删除', danger: true, onClick: () => message.info('暂不支持删除') }
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ];

  const [tableColumns, setTableColumns] = useState<any[]>(columns);

  return (
    <PageDetailSection
      title="SSH 密钥 (SSH Keys)"
      asCard={false}
      toolbarLeft={(
        <Input 
          allowClear 
          placeholder="关键字" 
          className="toolbar-search" 
          value={keyword} 
          onChange={(e)=> setKeyword(e.target.value)} 
        />
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={columns} 
            onChange={setTableColumns}
            settingsKey="harvester_ssh_keys_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={tableColumns}
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

export default SshKeysSection;
