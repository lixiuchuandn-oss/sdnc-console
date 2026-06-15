import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Table, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import WriteGuard from 'components/WriteGuard';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { useAuth } from 'contexts/AuthContext';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { hasPermissionForAction } from 'utils/accessMapping';
import {
  createHarvesterOvnMirror,
  deleteHarvesterOvnMirror,
  updateHarvesterOvnMirror,
} from 'services/harvester/ovnMirrors';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import { confirmHighRiskDelete, DELETE_NETWORK_RISK_ITEMS } from '../../shared/lib/highRiskConfirm';
import {
  applyOvnMirrorSourceVmAnnotations,
  collectOvnMirrorSourceAnnotationTargets,
  refreshOvnMirrorSourceAnnotationTargets,
  showOvnMirrorSourceRestartConfirm,
} from '../lib/ovnMirrorVmMirrorAnnotation';
import {
  enrichOvnMirrorTableRows,
  filterOvnMirrorRows,
  listOvnMirrorOccupiedSourceNicKeys,
  listOvnMirrorOccupiedSourceVmKeys,
  listOvnMirrorNicKeysFromRow,
  mapOvnMirrorsToTableRows,
  ovnMirrorCrToFormValues,
  ovnMirrorFormValuesToCreatePayloads,
  ovnMirrorFormValuesToUpdateSpec,
  type OvnMirrorDisplayRow,
  type OvnMirrorFormValues,
  type OvnMirrorTableRow,
} from '../lib/ovnMirrorSectionUtils';
import OvnMirrorRuleModal from '../modals/OvnMirrorRuleModal';

const TABLE_SETTINGS_KEY = 'harvester_ovn_mirrors_table';

type Props = {
  cloudId: string;
  ovnMirrors: unknown[];
  vms: unknown[];
  kubeOvnSubnets?: unknown[];
  subnetsLoading?: boolean;
  loading: boolean;
  apiAvailable?: boolean;
  apiError?: string;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
};

const OvnMirrorsSection: React.FC<Props> = ({
  cloudId,
  ovnMirrors,
  vms,
  kubeOvnSubnets = [],
  subnetsLoading = false,
  loading,
  apiAvailable = true,
  apiError,
  onRefresh,
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.traffic-mirroring.vpc:write') ||
      hasPermissionForAction(perms, 'clouds.traffic-mirroring.flat:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  const [keyword, setKeyword] = useState('');
  const [sourceVmFilter, setSourceVmFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<OvnMirrorTableRow | null>(null);
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const dataSource = useMemo(() => mapOvnMirrorsToTableRows(ovnMirrors), [ovnMirrors]);

  const displayRows = useMemo(
    () => enrichOvnMirrorTableRows(dataSource, vms),
    [dataSource, vms],
  );

  const filteredData = useMemo(
    () => filterOvnMirrorRows(displayRows, { keyword, sourceVmKey: sourceVmFilter }),
    [displayRows, keyword, sourceVmFilter],
  );

  const vmFilterOptions = useMemo(
    () =>
      [...new Set(displayRows.map((r) => `${r.sourceNamespace}/${r.sourceVmName}`))]
        .filter(Boolean)
        .map((v) => ({ value: v, label: v })),
    [dataSource],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const handleDelete = useCallback(
    (record: OvnMirrorTableRow) => {
      if (!canWrite) {
        message.error('无权限执行该操作');
        return;
      }
      void confirmHighRiskDelete({
        resourceLabel: '流量镜像规则',
        name: record.name,
        description: `确定删除流量镜像「${record.name}」吗？`,
        riskItems: DELETE_NETWORK_RISK_ITEMS,
        onConfirm: async () => {
          await deleteHarvesterOvnMirror(cloudId, record.name);
          message.success('删除成功');
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        },
      }).catch(() => undefined);
    },
    [canWrite, cloudId, onRefresh],
  );

  const occupiedSourceNicKeys = useMemo(() => {
    const keys = listOvnMirrorOccupiedSourceNicKeys(dataSource);
    if (!editingRow) return keys;
    const currentKeys = new Set(listOvnMirrorNicKeysFromRow(editingRow));
    return keys.filter((k) => !currentKeys.has(k));
  }, [dataSource, editingRow]);

  const occupiedSourceVmKeys = useMemo(() => {
    const keys = listOvnMirrorOccupiedSourceVmKeys(dataSource);
    if (!editingRow) return keys;
    const current = `${editingRow.sourceNamespace}/${editingRow.sourceVmName}`;
    return keys.filter((k) => k !== current);
  }, [dataSource, editingRow]);

  const handleSubmit = useCallback(
    async (values: OvnMirrorFormValues) => {
      const annotationTargets = collectOvnMirrorSourceAnnotationTargets(values, vms);

      if (editingRow) {
        const spec = ovnMirrorFormValuesToUpdateSpec(values);
        await updateHarvesterOvnMirror(cloudId, editingRow.name, { spec });
        message.success('更新成功');
      } else {
        const existingNames = dataSource.map((r) => r.name);
        const payloads = ovnMirrorFormValuesToCreatePayloads(
          values,
          vms,
          existingNames,
          occupiedSourceNicKeys,
          occupiedSourceVmKeys,
        );
        const results = await Promise.allSettled(
          payloads.map((p) => createHarvesterOvnMirror(cloudId, p)),
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length === payloads.length) {
          const reason = (failed[0] as PromiseRejectedResult).reason as { message?: string };
          throw new Error(reason?.message || '创建失败');
        }
        const resolvedTargets = await refreshOvnMirrorSourceAnnotationTargets(
          cloudId,
          annotationTargets,
        );
        const targetsNeedingAnnotation = resolvedTargets.filter(
          (t) => !t.mirrorAnnotationAlreadySet,
        );
        await applyOvnMirrorSourceVmAnnotations(cloudId, resolvedTargets);
        if (failed.length === 0) {
          message.success(
            payloads.length > 1 ? `已成功创建 ${payloads.length} 条流量镜像` : '创建成功',
          );
        } else {
          message.warning(
            `部分创建成功：${payloads.length - failed.length}/${payloads.length}，请刷新后核对`,
          );
        }
        setModalOpen(false);
        setEditingRow(null);
        if (targetsNeedingAnnotation.length > 0) {
          window.setTimeout(() => {
            showOvnMirrorSourceRestartConfirm({
              cloudId,
              targets: targetsNeedingAnnotation,
            });
          }, 0);
        }
        void runHarvesterSectionRefresh(onRefresh, { force: true });
        return;
      }
      setModalOpen(false);
      setEditingRow(null);
      void runHarvesterSectionRefresh(onRefresh, { force: true });
    },
    [cloudId, dataSource, editingRow, occupiedSourceNicKeys, occupiedSourceVmKeys, onRefresh, vms],
  );

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'sourceVmAlias',
        key: 'sourceVmAlias',
        fixed: 'left' as const,
        render: (alias: string, record: OvnMirrorDisplayRow) => (
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => {
              if (!canWrite) return;
              setEditingRow(record);
              setModalOpen(true);
            }}
          >
            {alias || record.sourceVmName || record.name}
          </Button>
        ),
      },
      {
        title: '规则ID',
        dataIndex: 'name',
        key: 'name',
      },
      {
        title: '源虚拟机',
        dataIndex: 'sourceDisplay',
        key: 'sourceVmNicDisplay',
      },
      { title: '规则数', dataIndex: 'ruleCount', key: 'ruleCount' },
      {
        title: '镜像流量接收端',
        dataIndex: 'destinationDisplay',
        key: 'destinationDisplay',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        render: (_: unknown, record: OvnMirrorDisplayRow) => (
          <ResourceActionsDropdown
            items={[
              {
                key: 'edit',
                label: '编辑',
                hidden: !canWrite,
                onClick: () => {
                  setEditingRow(record);
                  setModalOpen(true);
                },
              },
              {
                key: 'yaml',
                label: 'YAML',
                onClick: () =>
                  openYamlDrawer(
                    { ...(record.raw as object), kind: 'OvnMirror' },
                    { title: `流量镜像 YAML · ${record.name}` },
                  ),
              },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                hidden: !canWrite,
                onClick: () => handleDelete(record),
              },
            ]}
          />
        ),
      },
    ],
    [canWrite, handleDelete, openYamlDrawer],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_SETTINGS_KEY);

  return (
    <>
      <PageDetailSection
        title="流量镜像"
        toolbarLeft={
          <>
            <Input
              className="toolbar-search"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索名称、虚拟机、IP、接收端"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="源虚拟机"
              value={sourceVmFilter || undefined}
              onChange={(v) => setSourceVmFilter(v || '')}
              options={vmFilterOptions}
            />
            {(keyword || sourceVmFilter) && (
              <button
                type="button"
                className="toolbar-reset-btn"
                onClick={() => {
                  setKeyword('');
                  setSourceVmFilter('');
                }}
              >
                重置
              </button>
            )}
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <WriteGuard canWrite={canWrite}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingRow(null);
                  setModalOpen(true);
                }}
              >
                创建规则
              </Button>
            </WriteGuard>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_SETTINGS_KEY} />
            <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} />
          </div>
        }
      >
        {!apiAvailable ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="集群未安装 OvnMirror CRD 或 API 不可用"
            description={
              apiError ||
              '请确认集群已部署 ovnmirrors.hms.rivercloud.com CRD 后再使用流量镜像功能。'
            }
          />
        ) : null}
        {filteredData.length === 0 && !loading ? (
          <Empty description={apiAvailable ? '暂无流量镜像规则' : '无法加载流量镜像'} />
        ) : (
          <Table
            className="std-table"
            bordered={false}
            rowKey="key"
            loading={loading}
            columns={tableColumns}
            dataSource={filteredData}
            scroll={{ x: true }}
            pagination={{ size: 'small', showSizeChanger: true }}
          />
        )}
      </PageDetailSection>

      <OvnMirrorRuleModal
        open={modalOpen}
        cloudId={cloudId}
        vms={vms}
        kubeOvnSubnets={kubeOvnSubnets}
        subnetsLoading={subnetsLoading}
        editingName={editingRow?.name}
        occupiedSourceNicKeys={occupiedSourceNicKeys}
        occupiedSourceVmKeys={occupiedSourceVmKeys}
        initialValues={editingRow ? ovnMirrorCrToFormValues(editingRow.raw) : undefined}
        onClose={() => {
          setModalOpen(false);
          setEditingRow(null);
        }}
        onSubmit={handleSubmit}
      />

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        title={yamlDrawerTitle}
        viewLink={yamlViewLink}
        onClose={closeYamlDrawer}
      />
    </>
  );
};

export default OvnMirrorsSection;
