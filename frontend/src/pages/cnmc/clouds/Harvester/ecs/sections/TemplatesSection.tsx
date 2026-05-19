/**
 * @file TemplatesSection.tsx
 * @description Harvester VM ??????
 *
 * ?????
 * - ??????? Harvester ????????????????????????
 * - ?????? / ??????????
 * - ???????????? TableColumnSettings ???????
 * - ????????????? onRefresh???????????
 *
 * ?????
 * - ???????????????????????????????? API
 * - ?????? templates????? loading ?????? onRefresh ??? Harvester ????
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Input, Button, Select, message, App, Tag, Tooltip, Modal, Switch, Dropdown } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, CheckCircleTwoTone, SearchOutlined, ExclamationCircleOutlined, EllipsisOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import HarvesterTemplateDetailDrawer from '../../shared/components/HarvesterTemplateDetailDrawer';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { createHarvesterVmFromTemplate, deleteHarvesterResourceByLink } from '../../../../../../services/harvesterApi';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';

/**
 * Props ??
 *
 * @property cloudId    ????? ID??????????????????
 * @property templates  Harvester ????????VirtualMachineTemplate ???
 * @property loading    ?????????????????????? loading
 * @property onRefresh  ?????????????????? force ??
 */
interface Props {
  cloudId: string;
  templates: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean; // ???????
  /** ??????????????????? VM ??? metadata.namespace????? default */
  workspaceVmNamespace?: string;
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
): '??' | '????' | '????' => {
  if (!tpl) return '??';
  const ns = getTemplateNamespace(tpl);
  return isPublicNs(ns) ? '????' : '????';
};

const getTemplateDefaultVersion = (tpl: any): string => {
    // ???? status.defaultVersion?????? spec.defaultVersionId ??
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

/** ??????? VM???? placeholder ?????????? */
const QUICK_CREATE_VM_NAME_HINT = '??????????????';

/** ?????? metadata.name ????/???????????????? */
const HIDDEN_VM_TEMPLATE_NAMES = new Set([
  'windows-raw-image-base-template',
  'windows-iso-image-base-template',
  'iso-image-base-template',
  'raw-image-base-template',
]);

/**
 * TemplatesSection ??
 *
 * ???
 * - ?? Harvester VM ????
 * - ?????????????
 * - ??????????
 *
 * ???
 * - ??????????????????????????
 */
const TemplatesSection: React.FC<Props> = ({ 
  cloudId, 
  templates = [], 
  loading, 
  onRefresh, 
  isTenant = false,
  workspaceVmNamespace,
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
   * ???????? Input?
   * - ??????????????
   * - ??????????????? / ?????????
   */
  const [searchText, setSearchText] = useState('');
  // ????????
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  // ????????all/public/private
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

  const handleDelete = useCallback(
    async (tpl: any) => {
      if (!hasTemplatesWrite) {
        message.error('????????');
        return;
      }
      const ns = getTemplateNamespace(tpl);
      const name = getTemplateName(tpl);
      const alias = getTemplateAlias(tpl);
      const label = alias ? `${alias} (${name})` : name;

      modal.confirm({
        title: '???????',
        icon: <ExclamationCircleOutlined />,
        content: `??????? ${label} ??????????`,
        okText: '??',
        okType: 'danger',
        onOk: async () => {
          try {
            // Template Path: /apis/harvesterhci.io/v1beta1/namespaces/{ns}/virtualmachinetemplates/{name}
            const path = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
            await deleteHarvesterResourceByLink(cloudId, path);
            message.success('????');
            onRefresh?.(true);
          } catch (e: any) {
            message.error(`????: ${e.message}`);
          }
        },
      });
    },
    [hasTemplatesWrite, modal, cloudId, onRefresh],
  );

  /** ?????? VmSection ????????????????????/??? */
  const handleBatchDelete = () => {
    if (!hasTemplatesWrite) {
      message.error('????????');
      return;
    }
    if (selectedRowKeys.length === 0) return;

    modal.confirm({
      title: '?????????',
      icon: <ExclamationCircleOutlined />,
      content: `???????? ${selectedRowKeys.length} ?????????????`,
      okText: '????',
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
        if (ok > 0) message.success(`???? ${ok} ???`);
        if (fail.length > 0) {
          message.error(`???? ${fail.length} ??${fail.map((f) => f.id).join(', ')}`);
        }
        setSelectedRowKeys([]);
        if (ok > 0 || fail.length > 0) onRefresh?.(true);
      },
    });
  };

  const openQuickCreate = useCallback(
    (tpl: any) => {
      if (!hasTemplatesWrite) {
        message.error('????????');
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
      const vmNs =
        isTenant && String(workspaceVmNamespace || '').trim()
          ? String(workspaceVmNamespace).trim()
          : tplNs;
      await createHarvesterVmFromTemplate(cloudId, tplNs, tplName, {
        name: vmName,
        namespace: vmNs,
        autoStart: quickCreateAutoStart,
      });
      message.success('????');
      setQuickCreateVisible(false);
      setQuickCreateTpl(null);
      setQuickCreateName('');
    } catch (e: any) {
      message.error(e?.message || '????');
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

  /**
   * ??????allColumns?
   *
   * ???
   * - ?? useMemo ??????????????
   * - ???????????????? []
   *
   * ????
   * - ???????? metadata.name
   * - ???????????? Namespace
   * - ??????? spec.description
   * - ??????? metadata.creationTimestamp
   * - ??????????????????????
   */
  const allColumns = useMemo<ColumnsType<any>>(
    () => [
    {
      title: '????',
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
      title: '??ID',
      key: 'name',
      render: (_: any, r: any) => {
        const name = getTemplateName(r);
        return <span>{name}</span>;
      }
    },
    {
      title: '??',
      key: 'version',
      render: (_: any, r: any) => {
        const defaultVersion = getTemplateDefaultVersion(r);
        const latestVersion = getTemplateLatestVersion(r);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="blue">??: {defaultVersion}</Tag>
            <span>??: {latestVersion}</span>
          </div>
        );
      }
    },
    ...(!isTenant ? [{
      title: '???',
      key: 'scope',
      render: (_: any, r: any) => {
          const scope = getTemplateScope(r, isPublicNamespace);
          const isPublic = scope === '????';
          return <Tag color={isPublic ? 'orange' : 'cyan'}>{scope}</Tag>;
      }
    }] : []),
    ...(!isTenant
      ? [{
          title: '????',
          key: 'namespace',
          render: (_: any, r: any) => getTemplateNamespace(r) || '-'
        }]
      : []),
    {
      title: '??',
      key: 'description',
      ellipsis: true,
      render: (_: any, r: any) => (
          <Tooltip title={getTemplateDescription(r)} placement="topLeft">
              <span>{getTemplateDescription(r) || '-'}</span>
          </Tooltip>
      )
    },
    {
      title: '????',
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
      title: '??',
      key: 'actions',
      render: (_: any, r: any) => {
        const items: any[] = [
          {
            key: 'detail',
            label: '????',
            onClick: () => { handleOpenDrawer(r); },
          }
        ];

        items.push({
            key: 'ops_info',
            label: '??YAML',
            onClick: () =>
              openYamlDrawer(
                { ...r, kind: r?.kind || 'VirtualMachineTemplate' },
                { title: '?? YAML' },
              ),
          });

        items.push({
            key: 'create_vm',
            label: '?????????',
            disabled: !hasTemplatesWrite,
            onClick: () => openQuickCreate(r),
        });

        items.push(
          { type: 'divider' as const },
          {
            key: 'delete',
            label: '??',
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
    [hasTemplatesWrite, handleOpenDrawer, openYamlDrawer, openQuickCreate, handleDelete, isPublicNamespace],
  );

  /**
   * ????????????
   *
   * - ???? allColumns
   * - ?? TableColumnSettings ??? onChange ????
   * - ????? UI ?????/???????????????
   */
  // ???? hook ?????
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_templates_table');

  /**
   * ??????????? + ??????????
   */
  const baseData = useMemo(() => {
    return templates.filter(
      (t: any) => !HIDDEN_VM_TEMPLATE_NAMES.has(getTemplateName(t)),
    );
  }, [templates]);

  /**
   * ????????????????
   */
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    baseData.forEach((t: any) => {
      const ns = getTemplateNamespace(t);
      if (ns && !isSystemNamespace(ns)) nsSet.add(ns); // ????????
    });
    return Array.from(nsSet).map(ns => ({ value: ns, label: ns }));
  }, [baseData]);

  /**
   * ????????filteredData?
   *
   * ?????
   * - ?? baseData
   * - ????????
   * - ?????????
   */
  const filteredData = useMemo(() => {
    const rows = baseData.filter((t: any) => {
      // 1. ??????
      const ns = getTemplateNamespace(t);
      if (selectedNamespace && ns !== selectedNamespace) return false;
      // 1.1 ?????
      if (!isTenant && selectedScope === 'public' && !isPublicNamespace(ns)) return false;
      if (!isTenant && selectedScope === 'private' && isPublicNamespace(ns)) return false;

      // 2. ?????
      if (searchText) {
        const lower = searchText.toLowerCase();
        return getTemplateDisplayName(t).toLowerCase().includes(lower);
      }
      
      return true;
    });
    return [...rows].sort((a: any, b: any) => {
      const ta = new Date(a?.metadata?.creationTimestamp || 0).getTime();
      const tb = new Date(b?.metadata?.creationTimestamp || 0).getTime();
      return tb - ta;
    });
  }, [baseData, searchText, selectedNamespace, selectedScope, !isTenant, isPublicNamespace]);

  return (
      <PageDetailSection
        toolbarLeft={(
          <>
            <Input
              placeholder="??/ID"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="toolbar-search"
              allowClear
            />
            {!isTenant && (
              <Select
                allowClear
                showSearch
                placeholder="????"
                value={selectedNamespace || undefined}
                onChange={(v) => setSelectedNamespace((v as string) || '')}
                options={namespaceOptions}
                className="toolbar-filter-sm"
              />
            )}
            {!isTenant && (
              <Select
                allowClear
                placeholder="???"
                value={selectedScope || undefined}
                onChange={(val) => setSelectedScope((val as any) || '')}
                options={[
                  { value: 'public', label: '????' },
                  { value: 'private', label: '????' },
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
              ??
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
                    ? '??????'
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
                        label: <span style={{ color: '#ff4d4f' }}>????</span>,
                        disabled: !hasTemplatesWrite || selectedRowKeys.length === 0,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (!hasTemplatesWrite) {
                        message.error('?????????');
                        return;
                      }
                      if (selectedRowKeys.length === 0) {
                        message.warning('??????');
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
          scroll={{ x: true }}
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
            showTotal: (total) => `? ${total} ?`,
          }}
        />

        <Modal
          title="?????????"
          open={quickCreateVisible}
          okText="??"
          cancelText="??"
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
              <span>????</span>
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
          title={yamlDrawerTitle}
        />
      </PageDetailSection>
  );
};

export default TemplatesSection;
