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
import { Table, Button, message, Input, Select, Modal, Dropdown } from 'antd';
import { ReloadOutlined, SearchOutlined, EllipsisOutlined, TagTwoTone  } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import SshKeyCreateModal from '../modals/SshKeyCreateModal';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../context/HarvesterPublicNamespacesContext';
import { deleteHarvesterSshKey } from '../../../../services/harvesterApi';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

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
  onRefresh?: (force?: boolean, silent?: boolean) => void;

  isTenant?: boolean;
  mode?: 'standard' | 'ops';
  bordered?: boolean;
}

const SshKeysSection: React.FC<Props> = ({ 
  cloudId, 
  sshKeys, 
  loading, 
  onRefresh,
  isTenant,
  mode = 'ops',
  bordered = true
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasSshKeysWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.sshkeys:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  // 关键字搜索，仅用于前端过滤名称/命名空间
  const [keyword, setKeyword] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 详情抽屉状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');
  
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
        alias: raw.metadata?.annotations?.['tower.io/alias'],
        namespace: raw.metadata?.namespace || k.namespace,
        // 优先读取 spec.fingerprint，其次是 status.fingerprint，最后是外层字段
        fingerprint: raw.spec?.fingerprint || raw.status?.fingerprint || k.fingerprint || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || k.createdAt,
        raw,
      };
    });
  }, [sshKeys]);

  /**
   * 基础数据过滤（租户可见性）
   */
  const baseData = useMemo(() => {
    let d = dataSource;
    return d.filter((x: any) => {
      const ns = (x.namespace || '').toLowerCase();
      
      // 1. 租户模式: 严格隔离，禁止查看公共命名空间和系统命名空间
      if (isTenant) {
        return !isSystemNamespace(ns) && !isPublicNamespace(ns);
      }

      // 2. 管理员模式: 不展示系统命名空间资源
      if (isSystemNamespace(ns)) {
        return false;
      }

      return true;
    });
  }, [dataSource, isTenant, isPublicNamespace]);

  /**
   * 提取所有可用的命名空间选项
   */
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    baseData.forEach((item: any) => {
      const ns = item.namespace;
      if (ns && !isSystemNamespace(ns)) nsSet.add(ns); // 过滤系统命名空间
    });
    return Array.from(nsSet).sort().map(ns => ({ label: ns, value: ns }));
  }, [baseData]);

  /**
   * 前端过滤逻辑
   * - 命名空间：精确匹配
   * - 关键字：匹配名称/命名空间/别名
   */
  const filteredData = useMemo(() => {
    let d = baseData;

    if (namespaceFilter) {
      d = d.filter((x: any) => x.namespace === namespaceFilter);
    }

    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => 
        x.name.toLowerCase().includes(k) || 
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias.toLowerCase().includes(k))
      );
    }
    return d;
  }, [baseData, keyword, namespaceFilter]);

  const handleBatchDelete = () => {
    if (!hasSshKeysWrite) {
      message.error('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;
    
    Modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${selectedRowKeys.length} 个 SSH 密钥，是否确认？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const targets = dataSource.filter((item: any) => selectedRowKeys.includes(item.key));
          const results = await Promise.allSettled(
            targets.map((t: any) => deleteHarvesterSshKey(cloudId, t.namespace, t.name))
          );
          
          const successCount = results.filter(r => r.status === 'fulfilled').length;
          const failCount = results.length - successCount;
          
          if (successCount > 0) message.success(`成功删除 ${successCount} 个密钥`);
          if (failCount > 0) message.error(`${failCount} 个密钥删除失败`);
          
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      }
    });
  };

  const handleOpenOpsinfo = (record: any, tab: string = 'detail') => {
    // 构造符合 HarvesterResourceDrawer 要求的 record 对象
    const raw = record.raw || record;
    // 确保有 kind 字段，以便抽屉组件正确处理
    const r = { ...raw, kind: raw.kind || 'KeyPair' };
    
    setDetailRecord(r);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  /**
   * 表格列定义
   * - 名称列根据 showYaml 决定是否显示链接样式
   * - 操作列根据 showYaml 决定是否显示详情入口
   */
  const columns = useMemo(() => [
    { 
      title: '密钥名称', 
      dataIndex: 'alias', 
      key: 'alias',
      render: (text: string, record: any) => {
        // 如果有别名，显示别名，否则显示名称（name）
        const content = text || record.name;
        // [Security] 租户侧严禁查看 YAML 详情，此处移除所有点击链接
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <TagTwoTone  style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{content}</span>
          </span>
        );
      }
    },
    { 
      title: '密钥 ID', 
      dataIndex: 'name', 
      key: 'name',
      copyable: true,
      render: (text: string) => <span className="std-code">{text}</span>
    },
    ...(mode === 'ops' ? [{ title: '命名空间', dataIndex: 'namespace', key: 'namespace' }] : []),
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', className: 'std-time' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];

        // 仅在非租户模式下添加详情入口
        if (!isTenant && mode === 'ops') {
          items.push({ 
            key: 'opsinfo', 
            label: '查看YAML', 
            onClick: () => handleOpenOpsinfo(record, 'yaml')
          });
          items.push({ type: 'divider' as const });
        }

        items.push({ 
          key: 'delete', 
          label: '删除', 
          danger: true, 
          disabled: !hasSshKeysWrite,
          onClick: () => {
            if (!hasSshKeysWrite) {
              message.error('无权限执行该操作');
              return;
            }
            Modal.confirm({
              title: `确认删除密钥 ${record.name}?`,
              content: '此操作不可恢复。',
              okText: '删除',
              cancelText: '取消',
              okButtonProps: { danger: true },
              onOk: async () => {
                try {
                  await deleteHarvesterSshKey(cloudId, record.namespace, record.name);
                  message.success('删除成功');
                  onRefresh?.(true);
                } catch (e: any) {
                  message.error(e.message || '删除失败');
                }
              }
            });
          }
        });

        return (
          <ResourceActionsDropdown 
            items={items}
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasSshKeysWrite }}
          />
        );
      },
    },
  ], [isTenant, hasSshKeysWrite, mode]);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(columns, 'harvester_ssh_keys_table');

  return (
    <PageDetailSection
      title="SSH 密钥 (SSH Keys)"
      asCard={false}
      toolbarLeft={(
        <>
          <Input 
            allowClear 
            placeholder="名称/ID"  
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            className="toolbar-search" 
            value={keyword} 
            onChange={(e)=> setKeyword(e.target.value)} 
          />
          {!isTenant && mode === 'ops' && (
            <Select
              placeholder="命名空间"
              className="toolbar-filter-sm" 
              allowClear
              showSearch
              options={namespaceOptions}
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter((v as string) || '')}
            />
          )}
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNamespaceFilter('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" disabled={!hasSshKeysWrite} onClick={() => { if (!hasSshKeysWrite) return; setCreateModalVisible(true); }}>创建</Button>
          <Dropdown 
            menu={{ 
              items: [{ 
                key: 'delete', 
                label: '批量删除', 
                danger: true, 
                disabled: !hasSshKeysWrite || selectedRowKeys.length === 0,
                onClick: handleBatchDelete
              }] 
            }} 
            trigger={['click']}
          >
            <Button icon={<EllipsisOutlined />} disabled={!hasSshKeysWrite || selectedRowKeys.length === 0} />
          </Dropdown>
          <TableColumnSettingsButton 
            allColumns={columns} 
            settingsKey="harvester_ssh_keys_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </div>
      )}
    >
      <Table
        className="std-table"
        bordered={false}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        rowSelection={{
          selectedRowKeys: selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <SshKeyCreateModal 
        visible={createModalVisible}
        cloudId={cloudId}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={() => {
          setCreateModalVisible(false);
          // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，但后端会优先查询数据库）
          // 静默刷新，不显示提示信息
          onRefresh?.(true, true); // force=true 跳过缓存，silent=true 静默刷新
        }}
        isTenant={isTenant}
      />
      
      {/* 资源详情抽屉 */}
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="KeyPair"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default SshKeysSection;
