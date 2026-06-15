/**
 * 虚拟机 · 部署集选择（创建向导 / 变配共用）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Divider, Form, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd/es/form';
import {
  createDeploymentSet,
  fetchDeploymentSetOverview,
  type DeploymentSetRow,
} from 'services/harvester/deploymentSets';
import DeploymentSetFormModal, {
  type DeploymentSetFormValues,
} from '../../cluster/modals/DeploymentSetFormModal';
import {
  applyDeploymentSetToWizardForm,
  buildDeploymentSetSelectOptions,
  filterDeploymentSetsByProjectNamespace,
  findDeploymentSetById,
} from '../lib/vmDeploymentSet';
import { applyDeploymentSetExclusive } from '../lib/vmSchedulingExclusion';

export type VmDeploymentSetFieldProps = {
  cloudId: string | undefined;
  form: FormInstance;
  /** 业务项目（namespace）；未传时从表单 namespace 字段读取 */
  projectNamespace?: string;
  /** 指定主机、指标自动调度等场景下不可用 */
  disabled?: boolean;
  disabledReason?: string;
  /** 变配时传入，用于初始化 */
  initialSetId?: string;
  /** 租户 VM 向导：下拉内提供「创建部署集」入口 */
  allowCreate?: boolean;
  onSetsLoaded?: (sets: DeploymentSetRow[]) => void;
};

const VmDeploymentSetField: React.FC<VmDeploymentSetFieldProps> = ({
  cloudId,
  form,
  projectNamespace: projectNamespaceProp,
  disabled = false,
  disabledReason = '当前模式下不支持部署集',
  initialSetId,
  allowCreate = false,
  onSetsLoaded,
}) => {
  const { message } = App.useApp();
  const [sets, setSets] = useState<DeploymentSetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const watchedNamespace = Form.useWatch('namespace', form);
  const effectiveProjectNamespace = String(
    projectNamespaceProp ?? watchedNamespace ?? '',
  ).trim();
  const visibleSets = useMemo(
    () => filterDeploymentSetsByProjectNamespace(sets, effectiveProjectNamespace),
    [sets, effectiveProjectNamespace],
  );

  const reloadSets = useCallback(async () => {
    if (!cloudId || cloudId === 'all') {
      setSets([]);
      return [];
    }
    setLoading(true);
    try {
      const json: unknown = await fetchDeploymentSetOverview(cloudId, true);
      const deploymentSets = (json as { data?: { deploymentSets?: DeploymentSetRow[] } })?.data
        ?.deploymentSets;
      const list = Array.isArray(deploymentSets) ? deploymentSets : [];
      setSets(list);
      onSetsLoaded?.(list);
      return list;
    } catch {
      setSets([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [cloudId, onSetsLoaded]);

  useEffect(() => {
    if (!cloudId || cloudId === 'all') {
      setSets([]);
      applyDeploymentSetToWizardForm(form, null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchDeploymentSetOverview(cloudId)
      .then((json: unknown) => {
        if (cancelled) return;
        const deploymentSets = (json as { data?: { deploymentSets?: DeploymentSetRow[] } })?.data
          ?.deploymentSets;
        const list = Array.isArray(deploymentSets) ? deploymentSets : [];
        setSets(list);
        onSetsLoaded?.(list);
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId, onSetsLoaded, form]);

  useEffect(() => {
    if (!disabled) return;
    applyDeploymentSetToWizardForm(form, null);
  }, [disabled, form]);

  useEffect(() => {
    if (disabled || !initialSetId || !visibleSets.length) return;
    const current = form.getFieldValue?.('deploymentSetId');
    if (current) return;
    if (!findDeploymentSetById(visibleSets, initialSetId)) return;
    form.setFieldsValue({ deploymentSetId: initialSetId });
  }, [disabled, initialSetId, visibleSets, form]);

  useEffect(() => {
    if (disabled) return;
    const currentId = form.getFieldValue?.('deploymentSetId');
    if (!currentId) return;
    if (!findDeploymentSetById(visibleSets, String(currentId))) {
      applyDeploymentSetToWizardForm(form, null);
    }
  }, [disabled, visibleSets, form]);

  const options = useMemo(
    () => buildDeploymentSetSelectOptions(visibleSets),
    [visibleSets],
  );

  const selectPlaceholder = !effectiveProjectNamespace
    ? '请先选择项目'
    : visibleSets.length
      ? '未选择部署集'
      : '当前项目下暂无可用部署集';

  const namespaceOptionsForCreate = useMemo(() => {
    if (!effectiveProjectNamespace) return [];
    return [{ value: effectiveProjectNamespace, label: effectiveProjectNamespace }];
  }, [effectiveProjectNamespace]);

  const handleCreateSubmit = useCallback(
    async (values: DeploymentSetFormValues & { labels: Record<string, string> }) => {
      if (!cloudId || cloudId === 'all') return;
      setCreateSaving(true);
      try {
        const body = {
          name: values.name,
          namespace: effectiveProjectNamespace || values.namespace,
          labels: values.labels,
          description: values.description,
          sortOrder: values.sortOrder,
          schedulingPolicy: values.schedulingPolicy,
          schedulingStrength: values.schedulingStrength,
          topologyKey: values.topologyKey,
        };
        await createDeploymentSet(cloudId, body);
        message.success('部署集已创建');
        setCreateModalOpen(false);
        const list = await reloadSets();
        const created = list.find(
          (row) =>
            row.name === values.name &&
            String(row.namespace || '').trim() === effectiveProjectNamespace,
        );
        if (created) {
          applyDeploymentSetExclusive(form, created);
        }
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '创建失败');
      } finally {
        setCreateSaving(false);
      }
    },
    [cloudId, effectiveProjectNamespace, form, message, reloadSets],
  );

  const dropdownRender = allowCreate
    ? (menu: React.ReactNode) => (
        <>
          {menu}
          <Divider style={{ margin: '8px 0' }} />
          <Button
            type="link"
            icon={<PlusOutlined />}
            style={{ width: '100%', textAlign: 'left' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSelectOpen(false);
              if (!effectiveProjectNamespace) {
                message.warning('请先选择项目');
                return;
              }
              setCreateModalOpen(true);
            }}
          >
            创建部署集
          </Button>
        </>
      )
    : undefined;

  if (disabled) {
    return (
      <Form.Item name="deploymentSetId" label="部署集" preserve>
        <Select disabled placeholder={disabledReason} options={[]} />
      </Form.Item>
    );
  }

  return (
    <>
      <Form.Item name="deploymentSetId" label="部署集" preserve>
        <Select
          allowClear
          showSearch
          open={allowCreate ? selectOpen : undefined}
          onDropdownVisibleChange={allowCreate ? setSelectOpen : undefined}
          loading={loading}
          placeholder={selectPlaceholder}
          options={options}
          optionFilterProp="label"
          dropdownRender={dropdownRender}
          onChange={(value) => {
            const set = findDeploymentSetById(visibleSets, value as string | undefined);
            applyDeploymentSetExclusive(form, set);
          }}
        />
      </Form.Item>
      {allowCreate ? (
        <DeploymentSetFormModal
          open={createModalOpen}
          editing={null}
          namespaceOptions={namespaceOptionsForCreate}
          lockedNamespace={effectiveProjectNamespace || undefined}
          onClose={() => setCreateModalOpen(false)}
          onSubmit={handleCreateSubmit}
          saving={createSaving}
        />
      ) : null}
    </>
  );
};

export default VmDeploymentSetField;
