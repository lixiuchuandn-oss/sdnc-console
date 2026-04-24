/**
 * SDN / 流量编排 — CSM 安全资源池列表（不纳入多云「资源池管理」）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import PageContainer from '../../../components/PageContainer';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { fetchClouds as fetchCloudsApi, apiDelete } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { routeSpecs } from '../../../routes/RouteSpec';
import CloudWizard from '../../cnmc/pools/CloudWizard';
import CloudEditModal from '../../cnmc/clouds/Harvester/ecs/modals/CloudEditModal';
import {
  CLOUD_STATUS_MAP,
  resolvePoolTypeLabel,
  type Cloud,
  getProviderLogo,
  getProviderName,
  isCsmCloud,
} from '../../cnmc/pools/poolProviders';

const { Text } = Typography;

/** 与 `RouteSpec` 中 `traffic-csm-pools` 对齐：路径、文案、权限均单点维护 */
const trafficCsmPoolsSpec = routeSpecs.find((s) => s.id === 'traffic-csm-pools');
const csmPoolsListPath = trafficCsmPoolsSpec?.path ?? '/admin/security/traffic/csm-pools';
const csmPoolsPageAction = trafficCsmPoolsSpec?.requiredActions?.page ?? null;
const csmPoolsWriteAction = trafficCsmPoolsSpec?.requiredActions?.write ?? null;

const CsmPoolsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const canRead = hasPermissionForAction(perms, csmPoolsPageAction);
  const canWrite = hasPermissionForAction(perms, csmPoolsWriteAction);

  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Cloud | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fetchCloudsApi();
      const list = Array.isArray(raw) ? raw : (raw as { data?: Cloud[] })?.data || [];
      setClouds((Array.isArray(list) ? list : []).filter(isCsmCloud));
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = useCallback(
    (id: string) => {
      if (!canWrite) return;
      Modal.confirm({
        title: '确认删除该 CSM 资源池？',
        content: '删除后不可恢复，相关流量编排配置可能失效。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await apiDelete(`/api/clouds/${id}`);
            message.success('已删除');
            void load();
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err?.message || '删除失败');
          }
        },
      });
    },
    [canWrite, load],
  );

  const columns: ColumnsType<Cloud> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        render: (text: string, record) => (
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => navigate(`${csmPoolsListPath}/${record.id}`)}
          >
            {text}
          </Button>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (s: string) => CLOUD_STATUS_MAP[s] || s,
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        render: (t: string) => <Tag>{resolvePoolTypeLabel(t)}</Tag>,
      },
      {
        title: '厂商',
        key: 'provider',
        render: (_: unknown, record) => (
          <Space>
            <span style={{ fontSize: 16, display: 'flex', alignItems: 'center' }}>
              {getProviderLogo(record.config?.provider, record.type)}
            </span>
            <Text>{getProviderName(record.config?.provider)}</Text>
          </Space>
        ),
      },
      {
        title: '地域',
        dataIndex: 'region',
        key: 'region',
      },
      {
        title: '操作',
        key: 'op',
        width: 80,
        fixed: 'right',
        render: (_: unknown, record) => (
          <ResourceActionsDropdown
            items={[
              { key: 'edit', label: '编辑', disabled: !canWrite },
              { type: 'divider' },
              { key: 'delete', label: '删除', danger: true, disabled: !canWrite },
            ]}
            onClick={({ key }) => {
              if (key === 'edit') {
                setEditing(record);
                setEditOpen(true);
              }
              if (key === 'delete') handleDelete(record.id);
            }}
            buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
          />
        ),
      },
    ],
    [navigate, canWrite, handleDelete, csmPoolsListPath],
  );

  if (!canRead) {
    return (
      <PageContainer titleLevel={3} asCard={false}>
        <div style={{ padding: 24 }}>
          无访问权限。需要安全服务的读权限
          {csmPoolsPageAction ? `（${csmPoolsPageAction}）` : ''}。
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      primaryAction={{
        text: '接入资源池',
        onClick: () => setWizardVisible(true),
        disabled: !canWrite,
      }}
      onRefresh={() => void load()}
    >
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={clouds}
        className="vr-table std-table"
        bordered={false}
        pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }}
      />
      <CloudWizard
        visible={wizardVisible}
        csmOnly
        onCancel={() => setWizardVisible(false)}
        onSuccess={() => {
          setWizardVisible(false);
          void load();
        }}
      />
      <CloudEditModal
        visible={editOpen}
        cloud={editing}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onSuccess={() => {
          setEditOpen(false);
          setEditing(null);
          void load();
        }}
      />
    </PageContainer>
  );
};

export default CsmPoolsPage;
