/**
 * 定时任务 (CronJob) 列表与操作。
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Table, Select, Button, Input, Switch, Tooltip, App, Modal, Form } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import YamlEditor from '../../../../../../../components/YamlEditor';
import { useTableColumnSettings } from '../../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../../components/TableColumnSettingsButton';
import {
  deleteHarvesterCronJob,
  suspendHarvesterCronJob,
  resumeHarvesterCronJob,
  triggerHarvesterCronJob,
  patchHarvesterContainerResource,
} from '../../../../../../../services/harvesterApi';
import CronJobForm from '../CronJobForm';
import { useContainerOperationsReadOnly } from '../../ContainerOperationsContext';
import { buildCronJobTableColumns } from '../../lib/jobs/cronJobTableColumns';
import CronJobDetailDrawer from './CronJobDetailDrawer';

export type CronJobTableProps = {
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: (force?: boolean) => void;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  defaultNamespace?: string;
  createModalVisible: boolean;
  onCreateModalChange: (visible: boolean) => void;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
};

const CronJobTable: React.FC<CronJobTableProps> = ({
  data,
  loading,
  cloudId,
  onRefresh,
  namespacesOptions,
  nsValue,
  onNsChange,
  imagePullSecrets,
  secretsWithCredentials,
  defaultNamespace,
  createModalVisible,
  onCreateModalChange,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
}) => {
  const operationsReadOnly = useContainerOperationsReadOnly();
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentCronJob, setCurrentCronJob] = useState<any>(null);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');

  const apiPath = '/apis/batch/v1/cronjobs';
  
  // 过滤并排序数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
    
    // 按创建时间倒序排列（最新的在最上面）
    return filtered.sort((a: any, b: any) => {
      const timeA = new Date(a?.metadata?.creationTimestamp || 0).getTime();
      const timeB = new Date(b?.metadata?.creationTimestamp || 0).getTime();
      return timeB - timeA;
    });
  }, [data, keyword]);
  
  // 查看详情
  const handleViewDetail = useCallback((cronjob: any) => {
    setCurrentCronJob(cronjob);
    setDetailVisible(true);
  }, []);
  
  // 删除操作
  const handleDelete = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await deleteHarvesterCronJob(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 暂停 CronJob
  const handleSuspend = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await suspendHarvesterCronJob(cloudId, namespace, name);
      message.success('已暂停');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '暂停失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 恢复 CronJob
  const handleResume = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await resumeHarvesterCronJob(cloudId, namespace, name);
      message.success('已恢复');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '恢复失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 手动触发 CronJob
  const handleTrigger = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await triggerHarvesterCronJob(cloudId, namespace, name);
      message.success('已触发执行');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '触发失败');
    }
  }, [cloudId, message, onRefresh]);

  // 别名编辑
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.metadata?.annotations?.['tower.io/alias'];
    const aliasPath = '/metadata/annotations/tower.io~1alias';

    const patchBody: any[] = [];
    if (!next) {
      if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
    } else {
      if (!hasAnnotations) {
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
      } else {
        patchBody.push({ op: 'add', path: aliasPath, value: next });
      }
    }

    if (patchBody.length === 0) {
      setAliasModalVisible(false);
      return true;
    }

    setAliasSubmitting(true);
    try {
      await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh(true);
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlContent(yamlStr);
      setYamlModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);
  
  const columns = useMemo(
    () =>
      buildCronJobTableColumns({
        handleViewDetail,
        handleViewYaml,
        handleOpenAliasModal,
        handleDelete,
        handleSuspend,
        handleResume,
        handleTrigger,
        modal,
        operationsReadOnly,
      }),
    [
      handleViewDetail,
      handleViewYaml,
      handleOpenAliasModal,
      handleDelete,
      handleSuspend,
      handleResume,
      handleTrigger,
      modal,
      operationsReadOnly,
    ],
  );
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-cronjobs',
  );
  
  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/项目"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选项目"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nsValue || undefined}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          {showAllSwitch && (
            <Switch
              checkedChildren="全部"
              unCheckedChildren="默认"
              checked={queryAll}
              onChange={onQueryAllChange}
              style={{ marginRight: 8 }}
            />
          )}
          {!operationsReadOnly ? (
            <Button type="primary" onClick={() => onCreateModalChange(true)}>
              创建 CronJob
            </Button>
          ) : null}
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-cronjobs"
          />
          <Tooltip title="刷新">
            <Button type="default" icon={<ReloadOutlined />} onClick={() => onRefresh(true)} />
          </Tooltip>
        </div>
      </div>
      
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={
          operationsReadOnly
            ? undefined
            : {
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }
        }
      />
      
      {/* CronJob 详情抽屉 */}
      <CronJobDetailDrawer
        cronjob={currentCronJob}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentCronJob(null);
        }}
        cloudId={cloudId}
      />
      
      {/* 别名编辑 Modal */}
      <Modal
        title="名称修改"
        open={aliasModalVisible}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSubmitting}
        onOk={async () => {
          try {
            const values = await aliasForm.validateFields();
            await handleSubmitAlias(values?.alias);
          } catch {}
        }}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasRecord(null);
          aliasForm.resetFields();
        }}
      >
        <Form form={aliasForm} layout="vertical">
          <Form.Item
            name="alias"
            label="名称"
            rules={[
              { max: 64, message: '别名最长 64 个字符' },
              { required: true, message: '请输入名称' },
            ]}
          >
            <Input
              autoFocus
              placeholder="请输入名称（留空则清空别名）"
              maxLength={64}
              onPressEnter={async () => {
                if (aliasSubmitting) return;
                try {
                  const values = await aliasForm.validateFields();
                  await handleSubmitAlias(values?.alias);
                } catch {}
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* YAML 查看 Modal */}
      <Modal
        title="YAML 查看"
        open={yamlModalVisible}
        onCancel={() => setYamlModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
      
      {/* 创建 CronJob Modal */}
      <Modal
        title="创建 CronJob"
        open={createModalVisible}
        onCancel={() => onCreateModalChange(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
        <CronJobForm
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          onSuccess={() => {
            onCreateModalChange(false);
            onRefresh(true);
          }}
          onCancel={() => onCreateModalChange(false)}
          defaultNamespace={defaultNamespace}
        />
      </Modal>
    </div>
  );
};

export default CronJobTable;
