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
import { ReloadOutlined,SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import SshKeyCreateModal from '../modals/SshKeyCreateModal';

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
  /**
   * 视图控制属性
   * - bordered: 控制表格边框 (默认 true)
   * - showYaml: 控制是否显示详情/YAML入口 (默认 true)
   */
  bordered?: boolean;
  showYaml?: boolean;
  isTenant?: boolean;
}

const SshKeysSection: React.FC<Props> = ({ 
  cloudId, 
  sshKeys, 
  loading, 
  onRefresh,
  bordered = true,
  showYaml = true,
  isTenant
}) => {
  // 关键字搜索，仅用于前端过滤名称/命名空间
  const [keyword, setKeyword] = useState<string>('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  
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
   * - 名称列根据 showYaml 决定是否显示链接样式
   * - 操作列根据 showYaml 决定是否显示详情入口
   */
  const columns = useMemo(() => [
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name', 
      className: showYaml ? 'cell-link' : undefined,
      render: (text: string) => (
        showYaml ? (
          <span className="cell-link" onClick={() => message.info('详情功能开发中')}>{text}</span>
        ) : (
          <span>{text}</span>
        )
      )
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '指纹 (Fingerprint)', dataIndex: 'fingerprint', key: 'fingerprint', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180, className: 'std-time' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];

        // 仅在 showYaml 为 true 时添加详情入口
        if (showYaml) {
          items.push({ 
            key: 'detail', 
            label: '查看YAML', 
            onClick: () => message.info('详情功能开发中') 
          });
          items.push({ type: 'divider' as const });
        }

        items.push({ 
          key: 'delete', 
          label: '删除', 
          danger: true, 
          onClick: () => message.info('暂不支持删除') 
        });

        return (
          <ResourceActionsDropdown 
            items={items}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ], [showYaml]);

  const [tableColumns, setTableColumns] = useState<any[]>(columns);

  return (
    <PageDetailSection
      title="SSH 密钥 (SSH Keys)"
      asCard={false}
      toolbarLeft={(
        <Input 
          allowClear 
          placeholder="关键字"  
          suffix={<SearchOutlined />}
          className="toolbar-search" 
          value={keyword} 
          onChange={(e)=> setKeyword(e.target.value)} 
        />
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => setCreateModalVisible(true)}>创建</Button>
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
        bordered={bordered}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />
      <SshKeyCreateModal 
        visible={createModalVisible}
        cloudId={cloudId}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={() => {
          setCreateModalVisible(false);
          onRefresh?.(true);
        }}
        isTenant={isTenant}
      />
    </PageDetailSection>
  );
};

export default SshKeysSection;
