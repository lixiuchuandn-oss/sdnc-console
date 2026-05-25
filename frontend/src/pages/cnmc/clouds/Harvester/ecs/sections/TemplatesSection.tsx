/**
 * Harvester - VM 模板列表 Section
 * 列表列与筛选逻辑见 `ecs/lib/templatesSectionUtils.ts`、`templatesTableColumns.tsx`。
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Table, Input, Button, Select, message, App, Modal, Switch, Dropdown, Tooltip } from 'antd';
import { ReloadOutlined, ExclamationCircleOutlined, EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import HarvesterTemplateDetailDrawer from '../../shared/components/HarvesterTemplateDetailDrawer';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { createHarvesterVmFromTemplate } from 'services/harvester/vm';
import { deleteHarvesterResourceByLink } from 'services/harvester/resource';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import {
  buildTemplateNamespaceOptions,
  buildTemplateYamlRecord,
  filterHiddenBaseTemplates,
  filterTemplateListRows,
  getTemplateNamespace,
  getTemplateName,
  getTemplateRowKey,
  QUICK_CREATE_VM_NAME_HINT,
} from '../lib/templatesSectionUtils';
import {
  buildTemplateDeleteRequest,
  mapBatchTemplateDelete,
  selectTemplatesByRowKeys,
  summarizeBatchTemplateDeleteMessage,
} from '../lib/templatesSectionActions';
import {
  buildTemplatesTableColumns,
  HARVESTER_TEMPLATES_TABLE_SETTINGS_KEY,
} from '../lib/templatesTableColumns';

interface Props {
  cloudId: string;
  templates: any[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
  bordered?: boolean;
  workspaceVmNamespace?: string;
}

const TemplatesSection: React.FC<Props> = ({
  cloudId,
  templates = [],
  loading,
  onRefresh,
  isTenant = false,
  bordered = true,
}) => {
  const { modal } = App.useApp();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasTemplatesWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.templates:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  const [searchText, setSearchText] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<'' | 'public' | 'private'>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);
  const [quickCreateVisible, setQuickCreateVisible] = useState(false);
  const [quickCreateTpl, setQuickCreateTpl] = useState<any>(null);
  const [quickCreateName, setQuickCreateName] = useState('');
  const [quickCreateAutoStart, setQuickCreateAutoStart] = useState(true);
  const [quickCreating, setQuickCreating] = useState(false);

  const baseData = useMemo(() => filterHiddenBaseTemplates(templates), [templates]);

  const namespaceOptions = useMemo(
    () => buildTemplateNamespaceOptions(baseData),
    [baseData],
  );

  const filteredData = useMemo(
    () =>
      filterTemplateListRows(baseData, {
        searchText,
        selectedNamespace,
        selectedScope,
        isPublicNamespace,
      }),
    [baseData, searchText, selectedNamespace, selectedScope, isPublicNamespace],
  );

  const handleDelete = useCallback(
    async (tpl: any) => {
      if (!hasTemplatesWrite) {
        message.error('无权限执行该操作');
        return;
      }
      const { path, label } = buildTemplateDeleteRequest(tpl);
      modal.confirm({
        title: '确认删除模板？',
        icon: <ExclamationCircleOutlined />,
        content: `确定要删除模板 ${label} 吗？此操作不可恢复。`,
        okText: '删除',
        okType: 'danger',
        onOk: async () => {
          try {
            await deleteHarvesterResourceByLink(cloudId, path);
            message.success('删除成功');
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: any) {
            message.error(`删除失败: ${e.message}`);
          }
        },
      });
    },
    [hasTemplatesWrite, modal, cloudId, onRefresh],
  );

  const handleBatchDelete = useCallback(() => {
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
        const targets = selectTemplatesByRowKeys(
          filteredData,
          selectedRowKeys as Array<string | number>,
        );
        const results = await mapBatchTemplateDelete(targets, async (tpl) => {
          const { path } = buildTemplateDeleteRequest(tpl);
          await deleteHarvesterResourceByLink(cloudId, path);
        });
        const { success, error } = summarizeBatchTemplateDeleteMessage(results);
        if (success) message.success(success);
        if (error) message.error(error);
        setSelectedRowKeys([]);
        if (results.some((x) => x.ok) || results.some((x) => !x.ok)) {
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }
      },
    });
  }, [hasTemplatesWrite, selectedRowKeys, modal, filteredData, cloudId, onRefresh]);

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
    setDetailRecord({ ...tpl, kind: tpl?.kind || 'VirtualMachineTemplate' });
    setDetailVisible(true);
  }, []);

  const handleOpenYaml = useCallback(
    (tpl: any) => {
      if (!tpl) return;
      openYamlDrawer(buildTemplateYamlRecord(tpl), { title: '模板 YAML' });
    },
    [openYamlDrawer],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const allColumns = useMemo(
    () =>
      buildTemplatesTableColumns({
        isTenant,
        hasTemplatesWrite,
        isPublicNamespace,
        onOpenDrawer: handleOpenDrawer,
        onOpenYaml: handleOpenYaml,
        onQuickCreate: openQuickCreate,
        onDelete: handleDelete,
      }),
    [
      isTenant,
      hasTemplatesWrite,
      isPublicNamespace,
      handleOpenDrawer,
      handleOpenYaml,
      openQuickCreate,
      handleDelete,
    ],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    HARVESTER_TEMPLATES_TABLE_SETTINGS_KEY,
  );

  return (
    <PageDetailSection
      toolbarLeft={
        <>
          <Input
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="toolbar-search"
            allowClear
          />
          {!isTenant && (
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
      }
      toolbarRight={
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
            settingsKey={HARVESTER_TEMPLATES_TABLE_SETTINGS_KEY}
          />
          {onRefresh && (
            <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
          )}
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => getTemplateRowKey(r)}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: true }}
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

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || '模板 YAML'}
      />
    </PageDetailSection>
  );
};

export default TemplatesSection;
