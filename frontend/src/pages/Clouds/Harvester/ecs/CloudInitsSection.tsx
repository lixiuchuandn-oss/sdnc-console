/**
 * Harvester - Cloud Init 模板列表 Section
 * 用于展示 Harvester 集群中的 Cloud Init 模板，
 * 支持按名称/命名空间关键字过滤、列显示配置及手动刷新。
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input, Select } from 'antd';
import { ReloadOutlined, SearchOutlined, TagTwoTone } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../context/HarvesterPublicNamespacesContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，预留给后续与 Cloud Init 相关的操作调用使用
 * - cloudInits: Cloud Init 模板列表，可能为原始对象或带 rawData 的包装对象
 * - loading: 外部传入的加载状态，控制表格和刷新按钮的 loading
 * - onRefresh: 手动刷新回调，支持传入 force=true 触发强制刷新
 */
interface Props {
  cloudId: string;
  cloudInits: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean;
  mode?: 'standard' | 'ops';
}

const CloudInitsSection: React.FC<Props> = ({ 
  cloudId, 
  cloudInits, 
  loading, 
  onRefresh,
  isTenant = false,
  mode = 'ops'
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasCloudInitsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.cloudinits:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  // 搜索关键字，仅在前端做简单的名称/命名空间模糊匹配
  const [keyword, setKeyword] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');

  /**
   * 将后端返回的数据统一转换为表格可使用的扁平结构
   * 优先读取 rawData.metadata 下的 K8s 原生字段，兼容回退到数据库字段
   */
  const dataSource = useMemo(() => {
    return (cloudInits || []).map((c: any) => {
      const raw = c.rawData || c;
      return {
        key: raw.metadata?.uid || c.id,
        name: raw.metadata?.name || c.name,
        namespace: raw.metadata?.namespace || c.namespace,
        description: raw.metadata?.annotations?.['harvesterhci.io/cloud-init-template-description'] || c.description || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || c.createdAt,
        raw,
      };
    });
  }, [cloudInits]);

  const baseData = useMemo(() => {
    return dataSource.filter((x: any) => {
      const ns = (x.namespace || '').toLowerCase();
      if (isTenant) {
        return !isSystemNamespace(ns) && !isPublicNamespace(ns);
      }
      return !isSystemNamespace(ns);
    });
  }, [dataSource, isTenant, isPublicNamespace]);

  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    baseData.forEach((item: any) => {
      const ns = item.namespace;
      if (ns && !isSystemNamespace(ns)) nsSet.add(ns);
    });
    return Array.from(nsSet).sort().map((ns) => ({ value: ns, label: ns }));
  }, [baseData]);

  /**
   * 前端过滤逻辑
   * - 仅基于关键字对名称和命名空间做包含匹配
   */
  const filteredData = useMemo(() => {
    let d = baseData;

    if (namespaceFilter) {
      d = d.filter((x: any) => x.namespace === namespaceFilter);
    }

    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [baseData, keyword, namespaceFilter]);

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
      render: (text: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <TagTwoTone twoToneColor={['#1890ff', '#91caff']} style={{ fontSize: 16, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{text}</span>
        </span>
      ),
    },
    ...(mode === 'ops' ? [{ title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 }] : []),
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180, className: 'std-time' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];

        // 非租户模式显示运维信息入口
        if (!isTenant && mode === 'ops') {
          items.push({ 
            key: 'opsinfo', 
            label: '查看YAML', 
            onClick: () => message.info('详情功能开发中') 
          });
          items.push({ type: 'divider' as const });
        }

        items.push({ 
          key: 'delete', 
          label: '删除', 
          danger: true, 
          disabled: !hasCloudInitsWrite,
          onClick: () => {
            if (!hasCloudInitsWrite) {
              message.error('无权限执行该操作');
              return;
            }
            message.info('暂不支持删除');
          } 
        });

        return (
          <ResourceActionsDropdown 
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasCloudInitsWrite }}
            items={items}
          />
        );
      },
    },
  ], [isTenant, hasCloudInitsWrite, mode]);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(columns, 'harvester_cloudinits_table');

  return (
    <PageDetailSection
      title="Cloud Init 模板"
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
              allowClear
              showSearch
              placeholder="命名空间"
              className="toolbar-filter-sm"
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
        <>
          <TableColumnSettingsButton 
            allColumns={columns} 
            settingsKey="harvester_cloud_inits_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      )}
    >
      <Table
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={false}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
    </PageDetailSection>
  );
};

export default CloudInitsSection;
