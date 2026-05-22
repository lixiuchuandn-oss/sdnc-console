/**
 * 物理接入交换机（HSM）— 集群 Tab 区块
 *
 * Cloudmap「集群 → 物理交换机」：管理 Switch CR，并展示 HSM 探测状态。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Flex, Input, message, Modal, Select, Table, Typography } from 'antd';
import { PlusOutlined, RadarChartOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import {
  createHmsSwitchCr,
  deleteHmsSwitchCr,
  updateHmsSwitchCr,
  type HmsSwitchCr,
  type HmsSwitchCrSpec,
} from '../../../../../../services/harvesterApi';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import HmsServiceMonitorCard from '../components/HmsServiceMonitorCard';
import HmsSwitchConfigDrawer from '../drawers/HmsSwitchConfigDrawer';
import HmsSwitchDetailDrawer from '../drawers/HmsSwitchDetailDrawer';
import { usePhysicalSwitchesData } from '../hooks/usePhysicalSwitchesData';
import {
  apiErrorMessage,
  buildSwitchTableRows,
  buildVendorFilterOptions,
  countMatchedProbeRows,
  filterSwitchTableRows,
} from '../lib/physicalSwitchesSectionUtils';
import { buildPhysicalSwitchesTableColumns } from '../lib/physicalSwitchesTableColumns';

const TABLE_COLUMNS_SETTINGS_KEY = 'harvester_hms_switch_config_table';

export type PhysicalSwitchesSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const PhysicalSwitchesSection: React.FC<PhysicalSwitchesSectionProps> = ({
  cloudId,
  checkPerm,
}) => {
  const canRead = checkPerm('clouds.cluster-networks:read');
  const canManageSwitchCr = checkPerm('clouds.cluster-networks:write');

  const [keyword, setKeyword] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [switchCrDrawerOpen, setSwitchCrDrawerOpen] = useState(false);
  const [editingSwitchCr, setEditingSwitchCr] = useState<HmsSwitchCr | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailSwitchCr, setDetailSwitchCr] = useState<HmsSwitchCr | null>(null);

  const {
    hmsSwitchConfigs,
    probeItems,
    probeMeta,
    serviceMonitorRows,
    serviceMonitorLoading,
    loading,
    probeLoading,
    hsmMonitorModalOpen,
    setHsmMonitorModalOpen,
    loadAll,
    handleHsmProbe,
  } = usePhysicalSwitchesData(cloudId, canRead, canManageSwitchCr);

  const {
    yamlDrawerOpen,
    yamlViewLink,
    yamlDrawerTitle,
    openYamlDrawer,
    closeYamlDrawer,
  } = useHarvesterResourceLinkYamlDrawer(cloudId);

  const tableRows = useMemo(
    () => buildSwitchTableRows(hmsSwitchConfigs, probeItems),
    [hmsSwitchConfigs, probeItems],
  );

  const matchedProbeCount = useMemo(
    () => countMatchedProbeRows(tableRows),
    [tableRows],
  );

  const vendorOptions = useMemo(
    () => buildVendorFilterOptions(hmsSwitchConfigs),
    [hmsSwitchConfigs],
  );

  const filteredRows = useMemo(
    () => filterSwitchTableRows(tableRows, keyword, vendorFilter),
    [tableRows, keyword, vendorFilter],
  );

  const closeConfigDrawer = useCallback(() => {
    setSwitchCrDrawerOpen(false);
    setEditingSwitchCr(null);
  }, []);

  const closeDetailDrawer = useCallback(() => {
    setDetailDrawerOpen(false);
    setDetailSwitchCr(null);
  }, []);

  const openCreateSwitchCr = useCallback(() => {
    setEditingSwitchCr(null);
    setSwitchCrDrawerOpen(true);
  }, []);

  const openEditSwitchCr = useCallback((cr: HmsSwitchCr) => {
    setEditingSwitchCr(cr);
    setSwitchCrDrawerOpen(true);
  }, []);

  const openDetailDrawer = useCallback((cr: HmsSwitchCr) => {
    setDetailSwitchCr(cr);
    setDetailDrawerOpen(true);
  }, []);

  const openSwitchYamlDrawer = useCallback(
    (record: HmsSwitchCr) => {
      openYamlDrawer(
        { ...record, kind: record.kind || 'Switch' },
        { title: '交换机 YAML' },
      );
    },
    [openYamlDrawer],
  );

  const handleDeleteSwitchCr = useCallback(
    (cr: HmsSwitchCr) => {
      const name = String(cr?.metadata?.name || '').trim();
      if (!name || !canManageSwitchCr) return;
      Modal.confirm({
        title: `删除交换机「${name}」？`,
        content: '删除后 HSM 将不再管理该交换机。',
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          await deleteHmsSwitchCr(cloudId, name);
          message.success('已删除');
          await loadAll();
        },
      });
    },
    [canManageSwitchCr, cloudId, loadAll],
  );

  const handleSubmitSwitchCr = useCallback(
    async (payload: { name: string; spec: Record<string, unknown> }) => {
      if (!canManageSwitchCr) return;
      setConfigSaving(true);
      try {
        if (editingSwitchCr?.metadata?.name) {
          await updateHmsSwitchCr(cloudId, editingSwitchCr.metadata.name, {
            spec: payload.spec as HmsSwitchCrSpec,
          });
          message.success('配置已更新');
        } else {
          await createHmsSwitchCr(cloudId, {
            name: payload.name,
            spec: payload.spec as HmsSwitchCrSpec,
          });
          message.success('配置已创建');
        }
        closeConfigDrawer();
        await loadAll();
      } catch (e) {
        message.error(apiErrorMessage(e, '保存失败'));
        throw e;
      } finally {
        setConfigSaving(false);
      }
    },
    [canManageSwitchCr, cloudId, closeConfigDrawer, editingSwitchCr, loadAll],
  );

  const allColumns = useMemo(
    () =>
      buildPhysicalSwitchesTableColumns({
        canRead,
        canManageSwitchCr,
        onDetail: openDetailDrawer,
        onYaml: openSwitchYamlDrawer,
        onEdit: openEditSwitchCr,
        onDelete: handleDeleteSwitchCr,
      }),
    [
      canRead,
      canManageSwitchCr,
      openDetailDrawer,
      openSwitchYamlDrawer,
      openEditSwitchCr,
      handleDeleteSwitchCr,
    ],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    TABLE_COLUMNS_SETTINGS_KEY,
  );

  const monitorHeaderExtra = useMemo(() => {
    const syncedAt = probeMeta.cacheSyncedAt
      ? new Date(probeMeta.cacheSyncedAt).toLocaleString('zh-CN')
      : null;
    const sourceLabel =
      probeMeta.source === 'live'
        ? '实时'
        : probeMeta.source === 'database'
          ? '缓存'
          : null;
    return (
      <>
        {sourceLabel ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            实例数据：{sourceLabel}
          </Typography.Text>
        ) : null}
        {syncedAt ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            末次入库 {syncedAt}
          </Typography.Text>
        ) : null}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已匹配 {matchedProbeCount}/{hmsSwitchConfigs.length}
        </Typography.Text>
      </>
    );
  }, [
    hmsSwitchConfigs.length,
    matchedProbeCount,
    probeMeta.cacheSyncedAt,
    probeMeta.source,
  ]);

  const dataBusy = loading || probeLoading || serviceMonitorLoading;

  const resetFilters = useCallback(() => {
    setKeyword('');
    setVendorFilter('');
  }, []);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称 / 管理地址 / 型号"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="厂商"
            value={vendorFilter || undefined}
            onChange={(v) => setVendorFilter(v || '')}
            className="toolbar-filter-sm"
            options={vendorOptions}
            showSearch
            optionFilterProp="label"
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          {canManageSwitchCr ? (
            <>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateSwitchCr}>
                添加交换机
              </Button>
              <Button
                icon={<RadarChartOutlined />}
                loading={probeLoading || serviceMonitorLoading}
                onClick={() => void handleHsmProbe()}
              >
                HSM 探测
              </Button>
            </>
          ) : null}
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey={TABLE_COLUMNS_SETTINGS_KEY}
          />
          <Button icon={<ReloadOutlined />} loading={dataBusy} onClick={() => void loadAll()} />
        </div>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        size="small"
        rowKey={(r) => r.metadata?.name || r.metadata?.uid || 'row'}
        loading={loading}
        pagination={false}
        dataSource={filteredRows}
        columns={tableColumns}
      />

      <HmsSwitchConfigDrawer
        open={switchCrDrawerOpen}
        editing={editingSwitchCr}
        saving={configSaving}
        onClose={closeConfigDrawer}
        onSubmit={handleSubmitSwitchCr}
      />

      <HmsSwitchDetailDrawer
        open={detailDrawerOpen}
        cr={detailSwitchCr}
        cloudId={cloudId}
        canSync={canManageSwitchCr}
        onClose={closeDetailDrawer}
      />

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle}
      />

      <Modal
        title="HSM 服务监控"
        open={hsmMonitorModalOpen}
        onCancel={() => setHsmMonitorModalOpen(false)}
        footer={
          <Flex justify="flex-end" gap="small">
            <Button onClick={() => setHsmMonitorModalOpen(false)}>关闭</Button>
            {canManageSwitchCr ? (
              <Button
                type="primary"
                icon={<RadarChartOutlined />}
                loading={probeLoading || serviceMonitorLoading}
                onClick={() => void handleHsmProbe()}
              >
                重新探测
              </Button>
            ) : null}
          </Flex>
        }
        width={640}
        destroyOnHidden
      >
        <HmsServiceMonitorCard
          embedded
          rows={serviceMonitorRows}
          loading={serviceMonitorLoading || probeLoading}
          headerExtra={monitorHeaderExtra}
        />
      </Modal>
    </PageDetailSection>
  );
};

export default PhysicalSwitchesSection;
