/**
 * @file StorageClassesSection.tsx
 * @description Harvester StorageClass 列表视图
 *
 * 职责说明：
 * - 以表格形式展示 Harvester/Kubernetes 中的 StorageClass 列表
 * - 提供名称 / Provisioner 关键字搜索能力（前端本地过滤）
 * - 支持表格列显示配置（通过 TableColumnSettings 记住用户偏好）
 * - 支持打开 HarvesterResourceDrawer 侧边抽屉查看资源详情
 * - 支持触发上层传入的刷新回调 onRefresh，用于重新拉取列表数据
 *
 * 集成说明：
 * - 组件本身是一个“轻量视图”，只负责展示与简单筛选，不直接调用后端 API
 * - 列表数据 storageClasses、加载状态 loading 以及刷新函数 onRefresh 由上层 Harvester 页面注入
 * - 工具栏与表格样式遵循 `deployment/docs/specs/ui-components/page-detail-container.md` 中的规范，
 *   使用 `global-new.css` 中定义的公共样式（std-table、toolbar-search、toolbar-reset-btn 等）
 */

import React, { useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Dropdown, Modal, Tabs, Descriptions, Select } from 'antd';
import { ReloadOutlined, SearchOutlined, PieChartTwoTone  } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { fetchHarvesterStorageClassDetail } from '../../../../../../services/harvesterApi';
import { isSystemStorageClass } from '../../../../../../utils/harvesterUtils';

/**
 * Props 定义
 *
 * @property cloudId         当前云平台 ID（透传给 HarvesterResourceDrawer，用于其内部请求）
 * @property storageClasses  外层传入的 StorageClass 列表（通常为 K8s StorageClass 对象数组）
 * @property loading         外层传入的加载状态，用于控制表格与刷新按钮的 loading
 * @property onRefresh       触发上层重新拉取 StorageClass 列表的回调，支持 force 参数
 */
type Props = {
  cloudId: string;
  storageClasses: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean;
  mode?: 'standard' | 'ops';
};

/**
 * StorageClassesSection 组件
 *
 * 用途：
 * - 展示 Harvester 集群中的 StorageClass 列表
 * - 提供关键字搜索（名称 / Provisioner）
 * - 提供列设置和刷新能力
 * - 支持打开侧边抽屉查看单个 StorageClass 的详情与事件
 *
 * 说明：
 * - 不直接请求后端，只消费上层注入的数据和回调
 * - 工具栏和表格区域均遵循 PageDetailSection / global-new.css 的 UI 规范
 */
const StorageClassesSection: React.FC<Props> = ({ cloudId, storageClasses, loading, onRefresh, isTenant, mode = 'ops' }) => {
  const isStandardView = mode === 'standard';
  /**
   * 关键字搜索（受控 Input）
   * - 用户在顶部输入框中输入的文本
   * - 用于前端本地过滤 StorageClass 列表
   * - 匹配字段：名称（metadata.name）与 provisioner
   */
  const [keyword, setKeyword] = useState<string>('');
  const [provisionerFilter, setProvisionerFilter] = useState<string>('');
  const [reclaimPolicyFilter, setReclaimPolicyFilter] = useState<string>('');
  
  /**
   * HarvesterResourceDrawer 抽屉相关状态
   *
   * @detailVisible   抽屉是否可见
   * @detailRecord    当前选中的 StorageClass 记录（会注入 kind 字段，方便 EventsTab 识别资源类型）
   * @detailActiveTab 抽屉内部当前激活的 Tab（目前使用 'detail'）
   */
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  /**
   * 打开资源详情抽屉
   *
   * 设计要点：
   * - 为配合 HarvesterResourceDrawer 的事件页签（EventsTab），这里主动注入 kind: 'StorageClass'
   * - 支持指定默认激活的 Tab（当前仅使用 detail）
   */
  const handleOpenOpsinfo = async (record: any, tab: string = 'detail') => {
    const r = { ...record, kind: 'StorageClass' };
    setDetailRecord(r);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  /**
   * 表格所有列定义（allColumns）
   *
   * 特点：
   * - 使用 useMemo 避免每次渲染都重新创建列定义
   * - 不依赖组件外部状态，因此依赖数组为空 []
   *
   * 列说明：
   * - 名称：
   *   - 显示 metadata.name / name
   *   - 使用 .cell-link 样式，点击打开 HarvesterResourceDrawer 详情
   *   - 若为默认 StorageClass，额外显示 "Default" 徽章（std-badge std-badge-warning）
   * - Provisioner：显示 provisioner 字段
   * - 回收策略：reclaimPolicy
   * - 绑定模式：volumeBindingMode
   * - 允许扩容：allowVolumeExpansion（是/否）
   * - 创建时间：使用 std-time 样式展示 metadata.creationTimestamp
   * - 操作：
   *   - 使用 ResourceActionsDropdown 渲染操作菜单
   *   - 触发器按钮使用 .row-actions-trigger 公共样式
   */
  const allColumns = useMemo(() => [
    { 
      title: '名称', 
      key: 'name', 
      render: (_: any, r: any) => {
        const name = r?.metadata?.name || r?.name || '-';
        const isDefault = String(r?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] || '').toLowerCase() === 'true';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PieChartTwoTone/>
            <span>{name}</span>
            {isDefault && <span className="std-badge std-badge-warning">Default</span>}
          </div>
        );
      } 
    },
    { 
      title: 'Provisioner', 
      dataIndex: 'provisioner', 
      key: 'provisioner' 
    },
    { 
      title: '回收策略', 
      dataIndex: 'reclaimPolicy', 
      key: 'reclaimPolicy' 
    },
    { 
      title: '绑定模式', 
      dataIndex: 'volumeBindingMode', 
      key: 'volumeBindingMode' 
    },
    {
      title: '副本数',
      key: 'numberOfReplicas',
      render: (_: any, r: any) => {
        const replicas = r?.parameters?.numberOfReplicas;
        return replicas !== undefined && replicas !== null && String(replicas).trim() !== '' ? String(replicas) : '-';
      }
    },
    { 
      title: '允许扩容', 
      key: 'allowVolumeExpansion', 
      render: (_: any, r: any) => r?.allowVolumeExpansion ? '是' : '否' 
    },
    { 
      title: '创建时间', 
      key: 'age', 
      render: (_: any, r: any) => {
        const t = r?.metadata?.creationTimestamp;
        return t ? <span className="std-time">{t}</span> : '-';
      } 
    },
    { 
      title: '操作', 
      key: 'actions', 
      width: 80,
      align: 'left' as const,
      render: (_: any, r: any) => {
          const items: any[] = [];
          if (!isTenant && !isStandardView) {
            items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => handleOpenOpsinfo(r, 'detail') });
          }
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    },
  ], [isTenant, isStandardView]);

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_storageclasses_table');

  const visibleStorageClasses = useMemo(
    () =>
      (Array.isArray(storageClasses) ? storageClasses : []).filter(
        (r: any) => !isSystemStorageClass(r?.metadata?.name || r?.name || ''),
      ),
    [storageClasses],
  );

  const provisionerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          visibleStorageClasses
            .map((r: any) => String(r?.provisioner || '').trim())
            .filter(Boolean),
        ),
      ).sort(),
    [visibleStorageClasses],
  );
  const reclaimPolicyOptions = useMemo(
    () =>
      Array.from(
        new Set(
          visibleStorageClasses
            .map((r: any) => String(r?.reclaimPolicy || '').trim())
            .filter(Boolean),
        ),
      ).sort(),
    [visibleStorageClasses],
  );

  /**
   * 过滤后的数据源（filtered）
   *
   * 过滤逻辑：
   * - 当 keyword 为空时，直接返回原始 storageClasses
   * - 当 keyword 不为空时：
   *   - 将关键字转为小写
   *   - 仅保留名称（metadata.name/name）或 provisioner 中包含关键字的 StorageClass
   */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const pf = provisionerFilter.trim().toLowerCase();
    const rf = reclaimPolicyFilter.trim().toLowerCase();
    return visibleStorageClasses.filter((r: any) => {
      const name = String(r?.metadata?.name || r?.name || '').toLowerCase();
      const provisioner = String(r?.provisioner || '').toLowerCase();
      const reclaimPolicy = String(r?.reclaimPolicy || '').toLowerCase();
      if (kw && !(name.includes(kw) || provisioner.includes(kw))) return false;
      if (pf && provisioner !== pf) return false;
      if (rf && reclaimPolicy !== rf) return false;
      return true;
    });
  }, [visibleStorageClasses, keyword, provisionerFilter, reclaimPolicyFilter]);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input 
            allowClear 
            placeholder="名称/驱动" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search" 
          />
          <Select
            allowClear
            placeholder="驱动类型"
            value={provisionerFilter || undefined}
            onChange={(v) => setProvisionerFilter(v || '')}
            className="toolbar-filter-sm"
            options={provisionerOptions.map((p) => ({ value: p, label: p }))}
          />
          <Select
            allowClear
            placeholder="回收策略"
            value={reclaimPolicyFilter || undefined}
            onChange={(v) => setReclaimPolicyFilter(v || '')}
            className="toolbar-filter-sm"
            options={reclaimPolicyOptions.map((p) => ({ value: p, label: p }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setProvisionerFilter('');
              setReclaimPolicyFilter('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_storageclasses_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} />
        </>
      )}
    >
      <Table
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={false}
        rowKey={(r: any) => r?.metadata?.name || r?.name}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="StorageClass"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default StorageClassesSection;
