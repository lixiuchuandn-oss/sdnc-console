import React, { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DesktopOutlined, ApiOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { useCloudDesktopPermission } from '../../hooks/useCloudDesktopPermission';
import { fetchClouds } from '../../services/api';
import {
  createGuacamoleInstance,
  fetchGuacamoleInstances,
  fetchPoolGatewayAccess,
  testGuacamoleInstance,
  updateGuacamoleInstance,
  updatePoolGatewayConfig,
  type GuacamoleInstanceDto,
} from '../../services/guacamoleApi';

type PoolRow = {
  id: string;
  name?: string;
  type?: string;
  config?: { provider?: string };
};

type GatewayFormValues = {
  name: string;
  baseUrl: string;
  username: string;
  password?: string;
  desktop_user_password?: string;
  dataSource?: string;
  isDefault?: boolean;
};

type GatewayInstancePayload = {
  name: string;
  baseUrl: string;
  username: string;
  dataSource: string;
  isDefault: boolean;
  password?: string;
  desktop_user_password?: string;
};

const DesktopGatewaySettings: React.FC = () => {
  const { message } = App.useApp();
  const { canRead, canWrite } = useCloudDesktopPermission();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [instances, setInstances] = useState<GuacamoleInstanceDto[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [poolAccess, setPoolAccess] = useState<Record<string, { ready: boolean; poolEnabled: boolean }>>({});

  const activeInstance = useMemo(
    () => instances.find((i) => i.id === editingId) || instances[0] || null,
    [instances, editingId],
  );

  const loadInstances = async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const res = await fetchGuacamoleInstances();
      setInstances(Array.isArray(res?.data) ? res.data : []);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '加载网关失败');
    } finally {
      setLoading(false);
    }
  };

  const loadPools = async () => {
    try {
      const res = await fetchClouds();
      const list: PoolRow[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
          ? res.data
          : [];
      setPools(list);
      const accessEntries = await Promise.all(
        list.map(async (c) => {
          try {
            const a = await fetchPoolGatewayAccess(String(c.id));
            return [String(c.id), { ready: !!a.ready, poolEnabled: !!a.poolEnabled }] as const;
          } catch {
            return [String(c.id), { ready: false, poolEnabled: false }] as const;
          }
        }),
      );
      setPoolAccess(Object.fromEntries(accessEntries));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadInstances();
    void loadPools();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    if (!activeInstance) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      name: activeInstance.name,
      baseUrl: activeInstance.baseUrl,
      username: activeInstance.username,
      dataSource: activeInstance.dataSource || 'postgresql',
      isDefault: activeInstance.isDefault,
      password: '',
      desktop_user_password: '',
    });
  }, [activeInstance, form]);

  const onSave = async (values: GatewayFormValues) => {
    if (!canWrite) {
      message.warning('无权限修改云桌面网关配置');
      return;
    }
    try {
      const payload: GatewayInstancePayload = {
        name: String(values.name || '').trim(),
        baseUrl: String(values.baseUrl || '').trim(),
        username: String(values.username || '').trim(),
        dataSource: String(values.dataSource || 'postgresql').trim(),
        isDefault: values.isDefault !== false,
        ...(String(values.password || '').trim()
          ? { password: String(values.password).trim() }
          : {}),
        ...(String(values.desktop_user_password || '').trim()
          ? { desktop_user_password: String(values.desktop_user_password).trim() }
          : {}),
      };
      if (activeInstance?.id) {
        if (!payload.password) {
          const { password: _omit, ...rest } = payload;
          await updateGuacamoleInstance(activeInstance.id, rest);
        } else {
          await updateGuacamoleInstance(activeInstance.id, payload);
        }
        message.success('网关配置已更新');
      } else {
        if (!payload.password) {
          message.warning('新建网关须填写服务账号密码');
          return;
        }
        await createGuacamoleInstance(payload as GatewayInstancePayload & { password: string });
        message.success('网关已注册');
      }
      await loadInstances();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const onTest = async () => {
    if (!activeInstance?.id) {
      message.warning('请先保存网关配置');
      return;
    }
    setTesting(true);
    try {
      const res = await testGuacamoleInstance(activeInstance.id);
      if (res.ok) message.success(res.message || '连接成功');
      else message.error(res.message || '连接失败');
      await loadInstances();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const gatewayStatusTag = activeInstance ? (
    <Space size="small" wrap>
      <Tag color={activeInstance.status === 'online' ? 'success' : 'default'}>
        {activeInstance.status === 'online' ? '在线' : '未检测'}
      </Tag>
      {activeInstance.lastTestMessage ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {activeInstance.lastTestMessage}
        </Typography.Text>
      ) : null}
    </Space>
  ) : null;

  const poolColumns: ColumnsType<PoolRow> = [
    {
      title: '资源池',
      key: 'name',
      render: (_: unknown, r) => r.name || r.id,
    },
    {
      title: '类型',
      key: 'type',
      width: 120,
      render: (_: unknown, r) => String(r.type || r.config?.provider || '—'),
    },
    {
      title: '接入云桌面网关',
      key: 'enabled',
      width: 160,
      render: (_: unknown, r) => {
        const id = String(r.id);
        const enabled = poolAccess[id]?.poolEnabled ?? false;
        return (
          <Switch
            checked={enabled}
            disabled={!canWrite || !instances.length}
            onChange={async (checked) => {
              try {
                await updatePoolGatewayConfig(id, { enabled: checked });
                message.success(checked ? '已启用接入' : '已关闭接入');
                await loadPools();
              } catch (e: unknown) {
                message.error(e instanceof Error ? e.message : '更新失败');
              }
            }}
          />
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_: unknown, r) => {
        const st = poolAccess[String(r.id)];
        if (st?.ready) return <Tag color="success">可用</Tag>;
        if (st?.poolEnabled) return <Tag color="warning">待配置</Tag>;
        return <Tag>未接入</Tag>;
      },
    },
  ];

  if (!canRead) {
    return (
      <PageContainer asCard={false} titleLevel={3}>
        <Typography.Text type="secondary">无权限查看云桌面网关配置</Typography.Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer asCard={false} titleLevel={3}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card
          title={
            <span>
              <DesktopOutlined style={{ marginRight: 8 }} />
              云桌面网关注册
            </span>
          }
          extra={gatewayStatusTag}
          loading={loading}
        >
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            注册云桌面网关服务地址与 API 服务账号。配置云桌面用户统一密码后，在「用户 → 云桌面用户」中同步账号，并在下方为各资源池启用接入。
          </Typography.Paragraph>
          {instances.length > 1 ? (
            <Form.Item label="选择实例" style={{ maxWidth: 480 }}>
              <Select
                value={editingId || activeInstance?.id}
                onChange={(v) => setEditingId(v)}
                options={instances.map((i) => ({ value: i.id, label: i.name }))}
              />
            </Form.Item>
          ) : null}
          <Form form={form} layout="vertical" style={{ maxWidth: 520 }} onFinish={onSave}>
            <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="default" disabled={!canWrite} />
            </Form.Item>
            <Form.Item
              label="云桌面网关地址"
              name="baseUrl"
              rules={[{ required: true, message: '请输入地址' }]}
              extra="例：http://10.20.180.190:8080/guacamole"
            >
              <Input placeholder="http://host:8080/guacamole" disabled={!canWrite} />
            </Form.Item>
            <Form.Item
              label="服务账号"
              name="username"
              rules={[{ required: true, message: '请输入服务账号' }]}
            >
              <Input placeholder="platform-svc" disabled={!canWrite} />
            </Form.Item>
            <Form.Item
              label="服务账号密码"
              name="password"
              extra={activeInstance ? '留空表示不修改密码' : '新建时必填'}
            >
              <Input.Password placeholder="••••••" disabled={!canWrite} />
            </Form.Item>
            <Form.Item
              label="云桌面用户统一密码"
              name="desktop_user_password"
              extra={
                activeInstance?.hasDesktopUserPassword
                  ? '留空表示不修改；所有云桌面用户使用此密码登录云桌面网关'
                  : '云桌面用户登录云桌面网关的统一密码（必填后方能同步云桌面用户）'
              }
            >
              <Input.Password placeholder="••••••" disabled={!canWrite} />
            </Form.Item>
            <Form.Item label="数据源" name="dataSource">
              <Input placeholder="postgresql" disabled={!canWrite} />
            </Form.Item>
            <Form.Item label="设为默认实例" name="isDefault" valuePropName="checked">
              <Switch disabled={!canWrite} />
            </Form.Item>
            <Form.Item>
              <Space>
                {canWrite ? (
                  <Button type="primary" htmlType="submit">
                    {activeInstance ? '保存配置' : '注册网关'}
                  </Button>
                ) : null}
                {activeInstance && canWrite ? (
                  <Button loading={testing} onClick={() => void onTest()}>
                    测试连接
                  </Button>
                ) : null}
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card
          title={
            <span>
              <ApiOutlined style={{ marginRight: 8 }} />
              多云资源池接入
            </span>
          }
        >
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            启用后，该资源池内云主机可「分配云桌面」给云桌面用户（须 VM 运行中且有业务 IP）。
          </Typography.Paragraph>
          <Table
            className="std-table"
            bordered={false}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, size: 'small' }}
            dataSource={pools}
            columns={poolColumns}
            scroll={{ x: true }}
          />
        </Card>
      </div>
    </PageContainer>
  );
};

export default DesktopGatewaySettings;
