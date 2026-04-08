/**
 * @file TemplatesSection.tsx
 * @description Harvester VM 模板列表视图
 *
 * 职责说明：
 * - 以表格形式展示 Harvester 中的虚拟机模板（名称、命名空间、描述、创建时间）
 * - 提供基于名称 / 命名空间的关键字搜索
 * - 支持表格列显示配置（通过 TableColumnSettings 记住用户偏好）
 * - 支持触发上层传入的刷新回调 onRefresh，用于重新拉取模板列表
 *
 * 集成说明：
 * - 组件本身是一个“轻量视图”，只负责展示与简单筛选，不直接调用后端 API
 * - 模板列表数据 templates、加载状态 loading 以及刷新函数 onRefresh 由上层 Harvester 页面注入
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Input, Button, Select, message, App, Tag, Tooltip, Modal, Switch, Dropdown } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, CheckCircleTwoTone, SearchOutlined, ExclamationCircleOutlined, EllipsisOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageDetailSection from '../../../../components/PageDetailSection';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import HarvesterTemplateDetailDrawer from '../components/HarvesterTemplateDetailDrawer';
import HarvesterOpsinfoDrawer from '../components/HarvesterOpsinfoDrawer';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../context/HarvesterPublicNamespacesContext';
import { createHarvesterVmFromTemplate, deleteHarvesterResourceByLink } from '../../../../services/harvesterApi';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

/**
 * Props 定义
 *
 * @property cloudId    当前云平台 ID（此处仅透传占位，方便后续扩展操作）
 * @property templates  Harvester 返回的模板列表（VirtualMachineTemplate 数组）
 * @property loading    外层传入的加载状态，用于控制表格和刷新按钮的 loading
 * @property onRefresh  触发上层重新拉取模板列表的回调，支持 force 参数
 */
interface Props {
  cloudId: string;
  templates: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean; // 是否为租户模式
  mode?: 'standard' | 'ops';
  bordered?: boolean;
}

const getTemplateNamespace = (tpl: any): string =>
  tpl?.metadata?.namespace || tpl?.namespace || '';

const getTemplateName = (tpl: any): string =>
  tpl?.metadata?.name || tpl?.name || '';

const getTemplateDescription = (tpl: any): string =>
  tpl?.spec?.description || tpl?.metadata?.annotations?.description || '';

const getTemplateDisplayName = (tpl: any): string =>
  tpl?.spec?.displayName ||
  tpl?.metadata?.annotations?.['tower.io/template-alias'] ||
  tpl?.metadata?.annotations?.['field.cattle.io/displayName'] ||
  tpl?.metadata?.annotations?.['tower.io/alias'] ||
  getTemplateName(tpl);

const getTemplateAlias = (tpl: any): string =>
  tpl?.spec?.displayName ||
  tpl?.metadata?.annotations?.['tower.io/template-alias'] ||
  tpl?.metadata?.annotations?.['field.cattle.io/displayName'] ||
  tpl?.metadata?.annotations?.['tower.io/alias'] ||
  '';

const getTemplateScope = (
  tpl: any,
  isPublicNs: (name: string) => boolean,
): '全部' | '公共模板' | '私有模板' => {
  if (!tpl) return '全部';
  const ns = getTemplateNamespace(tpl);
  return isPublicNs(ns) ? '公共模板' : '私有模板';
};

const getTemplateDefaultVersion = (tpl: any): string => {
    // 优先展示 status.defaultVersion，其次尝试从 spec.defaultVersionId 解析
    if (tpl?.status?.defaultVersion) return `v${tpl.status.defaultVersion}`;
    if (tpl?.spec?.defaultVersionId) {
        const parts = tpl.spec.defaultVersionId.split('/');
        return `v${parts[parts.length - 1]}`;
    }
    return '-';
};

const getTemplateLatestVersion = (tpl: any): string => {
    if (tpl?.status?.latestVersion) return `v${tpl.status.latestVersion}`;
    return '-';
};

/** 从模板快速创建 VM：输入框 placeholder 与空值校验提示须一致 */
const QUICK_CREATE_VM_NAME_HINT = '请输入云主机名称（支持中文）';

/**
 * TemplatesSection 组件
 *
 * 用途：
 * - 展示 Harvester VM 模板列表
 * - 提供简单的前端搜索过滤能力
 * - 提供列设置和刷新按钮
 *
 * 说明：
 * - 此组件本身不直接调用后端，只消费上层传入的数据和回调
 */
const TemplatesSection: React.FC<Props> = ({ 
  cloudId, 
  templates = [], 
  loading, 
  onRefresh, 
  isTenant = false,
  mode = 'ops',
  bordered = true,
}) => {
  const { modal } = App.useApp();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasTemplatesWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.templates:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  /**
   * 搜索关键字（受控 Input）
   * - 用户在顶部输入框中输入的文本
   * - 用于在前端过滤模板列表（按名称 / 命名空间模糊匹配）
   */
  const [searchText, setSearchText] = useState('');
  // 命名空间筛选状态
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  // 作用域筛选状态：all/public/private
  const [selectedScope, setSelectedScope] = useState<'' | 'public' | 'private'>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [opsInfoVisible, setOpsInfoVisible] = useState(false);
  const [opsInfoRecord, setOpsInfoRecord] = useState<any>(null);
  const [opsInfoActiveTab, setOpsInfoActiveTab] = useState('detail');
  const [quickCreateVisible, setQuickCreateVisible] = useState(false);
  const [quickCreateTpl, setQuickCreateTpl] = useState<any>(null);
  const [quickCreateName, setQuickCreateName] = useState('');
  const [quickCreateAutoStart, setQuickCreateAutoStart] = useState(true);
  const [quickCreating, setQuickCreating] = useState(false);

  const handleDelete = useCallback(
    async (tpl: any) => {
      if (!hasTemplatesWrite) {
        message.error('无权限执行该操作');
        return;
      }
      const ns = getTemplateNamespace(tpl);
      const name = getTemplateName(tpl);
      const alias = getTemplateAlias(tpl);
      const label = alias ? `${alias} (${name})` : name;

      modal.confirm({
        title: '确认删除模板？',
        icon: <ExclamationCircleOutlined />,
        content: `确定要删除模板 ${label} 吗？此操作不可恢复。`,
        okText: '删除',
        okType: 'danger',
        onOk: async () => {
          try {
            // Template Path: /apis/harvesterhci.io/v1beta1/namespaces/{ns}/virtualmachinetemplates/{name}
            const path = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
            await deleteHarvesterResourceByLink(cloudId, path);
            message.success('删除成功');
            onRefresh?.(true);
          } catch (e: any) {
            message.error(`删除失败: ${e.message}`);
          }
        },
      });
    },
    [hasTemplatesWrite, modal, cloudId, onRefresh],
  );

  /** 批量删除（与 VmSection 一致：下拉「⋯」触发，确认后逐条统计成功/失败） */
  const handleBatchDelete = () => {
    if (!hasTemplatesWrite) {
      message.error('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;

    modal.confirm({
      title: '确认批量删除模板？',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除选中的 ${selectedRowKeys.length} 个模板吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      onOk: async () => {
        const targets = filteredData.filter((t: any) => {
          const k = t.metadata?.uid || t.metadata?.name;
          return selectedRowKeys.includes(k as React.Key);
        });
        const results: Array<{ ok: boolean; id: string; err?: string }> = [];
        for (const tpl of targets) {
          const ns = getTemplateNamespace(tpl);
          const name = getTemplateName(tpl);
          const alias = getTemplateAlias(tpl);
          const id = alias ? `${alias} (${ns}/${name})` : `${ns}/${name}`;
          try {
            const path = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
            await deleteHarvesterResourceByLink(cloudId, path);
            results.push({ ok: true, id });
          } catch (e: any) {
            results.push({ ok: false, id, err: e?.message || String(e) });
          }
        }
        const ok = results.filter((x) => x.ok).length;
        const fail = results.filter((x) => !x.ok);
        if (ok > 0) message.success(`删除成功 ${ok} 个模板`);
        if (fail.length > 0) {
          message.error(`删除失败 ${fail.length} 个：${fail.map((f) => f.id).join(', ')}`);
        }
        setSelectedRowKeys([]);
        if (ok > 0 || fail.length > 0) onRefresh?.(true);
      },
    });
  };

  const openQuickCreate = useCallback(
    (tpl: any) => {
      if (!hasTemplatesWrite) {
        message.error('无权限执行该操作');
        return;
      }
      if (!tpl) return;
      setQuickCreateTpl(tpl);
      setQuickCreateName('');
      setQuickCreateAutoStart(true);
      setQuickCreateVisible(true);
    },
    [hasTemplatesWrite],
  );

  const doQuickCreate = async () => {
    if (!quickCreateTpl) return;
    const tplNs = getTemplateNamespace(quickCreateTpl);
    const tplName = getTemplateName(quickCreateTpl);
    const vmName = String(quickCreateName || '').trim();
    if (!vmName) {
      message.warning(QUICK_CREATE_VM_NAME_HINT);
      return;
    }
    try {
      setQuickCreating(true);
      await createHarvesterVmFromTemplate(cloudId, tplNs, tplName, {
        name: vmName,
        namespace: tplNs,
        autoStart: quickCreateAutoStart,
      });
      message.success('创建成功');
      setQuickCreateVisible(false);
      setQuickCreateTpl(null);
      setQuickCreateName('');
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setQuickCreating(false);
    }
  };

  const handleOpenDrawer = useCallback((tpl: any) => {
    if (!tpl) return;
    const r = { ...tpl, kind: tpl?.kind || 'VirtualMachineTemplate' };
    setDetailRecord(r);
    setDetailVisible(true);
  }, []);

  const handleOpenOpsInfo = useCallback((tpl: any) => {
    if (!tpl) return;
    const ns = getTemplateNamespace(tpl);
    const name = getTemplateName(tpl);
    // 构造 view link 用于 HarvesterOpsinfoDrawer 获取实时数据
    // Template 路径: /apis/harvesterhci.io/v1beta1/namespaces/{ns}/virtualmachinetemplates/{name}
    const viewLink = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;

    const r = {
      ...tpl,
      kind: tpl?.kind || 'VirtualMachineTemplate',
      links: {
        ...(tpl?.links || {}),
        view: viewLink,
      },
    };
    setOpsInfoRecord(r);
    setOpsInfoActiveTab('detail');
    setOpsInfoVisible(true);
  }, []);
  
  /**
   * 表格列定义（allColumns）
   *
   * 特点：
   * - 使用 useMemo 避免每次渲染都重新创建列定义
   * - 不依赖外部状态，因此依赖数组为空 []
   *
   * 列说明：
   * - 名称：显示模板的 metadata.name
   * - 命名空间：显示模板所在的 Namespace
   * - 描述：显示模板 spec.description
   * - 创建时间：显示 metadata.creationTimestamp
   * - 操作：目前为占位文案“暂无操作”，后续可扩展
   */
  const allColumns = useMemo<ColumnsType<any>>(
    () => [
    {
      title: '模板名称',
      key: 'displayName',
      render: (_: any, r: any) => {
        const displayName = getTemplateDisplayName(r);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <CheckCircleTwoTone />
            <span
              className="cell-link"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
              onClick={() => handleOpenDrawer(r)}
            >
              {displayName}
            </span>
          </span>
        );
      }
    },
    {
      title: '模板ID',
      key: 'name',
      render: (_: any, r: any) => {
        const name = getTemplateName(r);
        return <span>{name}</span>;
      }
    },
    {
      title: '版本',
      key: 'version',
      render: (_: any, r: any) => {
        const defaultVersion = getTemplateDefaultVersion(r);
        const latestVersion = getTemplateLatestVersion(r);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="blue">默认: {defaultVersion}</Tag>
            <span>最新: {latestVersion}</span>
          </div>
        );
      }
    },
    ...(mode === 'ops' ? [{
      title: '作用域',
      key: 'scope',
      render: (_: any, r: any) => {
          const scope = getTemplateScope(r, isPublicNamespace);
          const isPublic = scope === '公共模板';
          return <Tag color={isPublic ? 'orange' : 'cyan'}>{scope}</Tag>;
      }
    }] : []),
    ...(mode === 'ops'
      ? [{
          title: '命名空间',
          key: 'namespace',
          render: (_: any, r: any) => getTemplateNamespace(r) || '-'
        }]
      : []),
    {
      title: '描述',
      key: 'description',
      ellipsis: true,
      render: (_: any, r: any) => (
          <Tooltip title={getTemplateDescription(r)} placement="topLeft">
              <span>{getTemplateDescription(r) || '-'}</span>
          </Tooltip>
      )
    },
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      sorter: (a: any, b: any) => {
        const t1 = a.metadata?.creationTimestamp || '';
        const t2 = b.metadata?.creationTimestamp || '';
        return t1.localeCompare(t2);
      },
      render: (_: any, r: any) => {
        const t = r.metadata?.creationTimestamp;
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, r: any) => {
        const items: any[] = [
          {
            key: 'detail',
            label: '资源详情',
            onClick: () => { handleOpenDrawer(r); },
          }
        ];

        // 仅在非租户模式下显示运维信息
        if (!isTenant && mode === 'ops') {
          items.push({
            key: 'ops_info',
            label: '查看YAML',
            onClick: () => { handleOpenOpsInfo(r); },
          });
        }

        items.push({
            key: 'create_vm',
            label: '使用模板创建虚拟机',
            disabled: !hasTemplatesWrite,
            onClick: () => openQuickCreate(r),
        });

        items.push(
          { type: 'divider' as const },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: !hasTemplatesWrite,
            onClick: () => handleDelete(r),
          }
        );

        return (
          <ResourceActionsDropdown
            items={items}
            buttonProps={{ 
              className: 'row-actions-trigger',
              style: { margin: 0 } 
            }}
          />
        );
      },
    }
  ],
    [isTenant, hasTemplatesWrite, mode, handleOpenDrawer, handleOpenOpsInfo, openQuickCreate, handleDelete, isPublicNamespace],
  );

  /**
   * 当前表格实际使用的列配置
   *
   * - 初始值为 allColumns
   * - 通过 TableColumnSettings 组件的 onChange 回调更新
   * - 用户可以在 UI 中选择显示/隐藏列，这里保存用户的选择结果
   */
  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_templates_table');

  /**
   * 基础数据（租户权限过滤）
   */
  const baseData = useMemo(() => {
    return templates;
  }, [templates]);

  /**
   * 命名空间选项（过滤系统命名空间）
   */
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    baseData.forEach((t: any) => {
      const ns = getTemplateNamespace(t);
      if (ns && !isSystemNamespace(ns)) nsSet.add(ns); // 过滤系统命名空间
    });
    return Array.from(nsSet).map(ns => ({ value: ns, label: ns }));
  }, [baseData]);

  /**
   * 最终展示的数据（filteredData）
   *
   * 过滤逻辑：
   * - 基于 baseData
   * - 应用命名空间筛选
   * - 应用名称关键字搜索
   */
  const filteredData = useMemo(() => {
    return baseData.filter((t: any) => {
      // 1. 命名空间筛选
      const ns = getTemplateNamespace(t);
      if (selectedNamespace && ns !== selectedNamespace) return false;
      // 1.1 作用域筛选
      if (mode === 'ops' && selectedScope === 'public' && !isPublicNamespace(ns)) return false;
      if (mode === 'ops' && selectedScope === 'private' && isPublicNamespace(ns)) return false;

      // 2. 关键字搜索
      if (searchText) {
        const lower = searchText.toLowerCase();
        return getTemplateDisplayName(t).toLowerCase().includes(lower);
      }
      
      return true;
    });
  }, [baseData, searchText, selectedNamespace, selectedScope, mode, isPublicNamespace]);

  return (
      <PageDetailSection
        toolbarLeft={(
          <>
            <Input
              placeholder="名称/ID"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="toolbar-search"
              allowClear
            />
            {!isTenant && mode === 'ops' && (
              <Select
                allowClear
                showSearch
                placeholder="命名空间"
                value={selectedNamespace || undefined}
                onChange={(v) => setSelectedNamespace((v as string) || '')}
                options={namespaceOptions}
                className="toolbar-filter-sm"
              />
            )}
            {mode === 'ops' && (
              <Select
                allowClear
                placeholder="作用域"
                value={selectedScope || undefined}
                onChange={(val) => setSelectedScope((val as any) || '')}
                options={[
                  { value: 'public', label: '公共模板' },
                  { value: 'private', label: '私有模板' },
                ]}
                className="toolbar-filter-sm"
              />
            )}
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setSearchText('');
                setSelectedNamespace('');
                setSelectedScope('');
              }}
            >
              重置
            </button>
          </>
        )}
        toolbarRight={(
          <>
            <Tooltip
              title={
                !hasTemplatesWrite
                  ? undefined
                  : selectedRowKeys.length === 0
                    ? '请先选择模板'
                    : undefined
              }
            >
              <span>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'batchDelete',
                        label: <span style={{ color: '#ff4d4f' }}>批量删除</span>,
                        disabled: !hasTemplatesWrite || selectedRowKeys.length === 0,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (!hasTemplatesWrite) {
                        message.error('无权限执行批量操作');
                        return;
                      }
                      if (selectedRowKeys.length === 0) {
                        message.warning('请先选择模板');
                        return;
                      }
                      if (key === 'batchDelete') handleBatchDelete();
                    },
                  }}
                >
                  <Button
                    icon={<EllipsisOutlined />}
                    disabled={!hasTemplatesWrite || selectedRowKeys.length === 0}
                  />
                </Dropdown>
              </span>
            </Tooltip>
            <TableColumnSettingsButton
              allColumns={allColumns}
              settingsKey="harvester_templates_table"
            />
            {onRefresh && (
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => onRefresh?.(true)} 
                loading={loading}
              />
            )}
          </>
        )}
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(r) => r.metadata?.uid || r.metadata?.name}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={tableColumns}
          dataSource={filteredData}
          loading={loading}
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
        />

        <Modal
          title="使用模板创建虚拟机"
          open={quickCreateVisible}
          okText="创建"
          cancelText="取消"
          confirmLoading={quickCreating}
          onOk={doQuickCreate}
          onCancel={() => {
            if (quickCreating) return;
            setQuickCreateVisible(false);
            setQuickCreateTpl(null);
            setQuickCreateName('');
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input
              placeholder={QUICK_CREATE_VM_NAME_HINT}
              value={quickCreateName}
              onChange={(e) => setQuickCreateName(e.target.value)}
              onPressEnter={() => doQuickCreate()}
              autoFocus
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>自动开机</span>
              <Switch checked={quickCreateAutoStart} onChange={setQuickCreateAutoStart} />
            </div>
          </div>
        </Modal>

        <HarvesterTemplateDetailDrawer
          open={detailVisible}
          onClose={() => setDetailVisible(false)}
          template={detailRecord}
          cloudId={cloudId}
        />
        
        <HarvesterOpsinfoDrawer
          open={opsInfoVisible}
          onClose={() => setOpsInfoVisible(false)}
          resourceType="Template"
          record={opsInfoRecord}
          activeTab={opsInfoActiveTab}
          onTabChange={setOpsInfoActiveTab}
          cloudId={cloudId}
        />
      </PageDetailSection>
  );
};

export default TemplatesSection;
