import React, { useEffect } from 'react';
import { Form, Input, Modal, Select } from 'antd';
import {
  fetchCloudDesktopUsers,
  fetchVmDesktopAssignments,
  type CloudDesktopUserDto,
} from '../../../../../../services/guacamoleApi';

type Props = {
  open: boolean;
  loading?: boolean;
  cloudId: string;
  namespace: string;
  vmName: string;
  defaultUsername?: string;
  defaultProtocol?: string;
  onCancel: () => void;
  onSubmit: (values: {
    desktop_user_ids: string[];
    username: string;
    password: string;
    protocol?: string;
  }) => void;
};

const VmAssignDesktopUsersModal: React.FC<Props> = ({
  open,
  loading,
  cloudId,
  namespace,
  vmName,
  defaultUsername,
  defaultProtocol,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm();
  const [users, setUsers] = React.useState<CloudDesktopUserDto[]>([]);
  const [fetching, setFetching] = React.useState(false);
  const [hasExistingAssignment, setHasExistingAssignment] = React.useState(false);

  useEffect(() => {
    if (!open || !cloudId || !namespace || !vmName) return;
    let cancelled = false;
    setFetching(true);
    Promise.all([
      fetchCloudDesktopUsers(),
      fetchVmDesktopAssignments(cloudId, namespace, vmName),
    ])
      .then(([userRes, assignRes]) => {
        if (cancelled) return;
        const list = Array.isArray(userRes?.data) ? userRes.data : [];
        setUsers(list.filter((u: CloudDesktopUserDto) => u.status === 'active'));
        const assignedIds = (assignRes?.data || []).map(
          (x: { desktop_user: CloudDesktopUserDto }) => x.desktop_user.id,
        );
        setHasExistingAssignment(assignedIds.length > 0);
        form.setFieldsValue({
          desktop_user_ids: assignedIds,
          username: defaultUsername || 'Administrator',
          protocol: defaultProtocol || 'auto',
          password: '',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
          setHasExistingAssignment(false);
        }
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, namespace, vmName, defaultUsername, defaultProtocol, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(values);
    } catch (e: unknown) {
      // Ant Design 校验失败会 reject { errorFields, ... }，已在表单项展示
      if (e && typeof e === 'object' && 'errorFields' in e) return;
    }
  };

  return (
    <Modal
      title="分配云桌面用户"
      open={open}
      onCancel={onCancel}
      confirmLoading={loading || fetching}
      destroyOnHidden
      width={520}
      onOk={() => void handleOk()}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="desktop_user_ids"
          label="云桌面用户"
          rules={[{ required: true, message: '请选择至少一个云桌面用户' }]}
          extra="选中用户将在云桌面网关中看到此 VM 连接（统一密码登录）"
        >
          <Select
            mode="multiple"
            placeholder="选择云桌面用户"
            loading={fetching}
            optionFilterProp="label"
            options={users.map((u) => ({
              value: u.id,
              label: `${u.fullName} (${u.username})`,
            }))}
          />
        </Form.Item>
        <Form.Item label="协议" name="protocol">
          <Select
            options={[
              { value: 'auto', label: '自动' },
              { value: 'rdp', label: 'RDP (Windows)' },
              { value: 'ssh', label: 'SSH' },
              { value: 'vnc', label: 'VNC' },
            ]}
          />
        </Form.Item>
        <Form.Item
          label="Guest 用户名"
          name="username"
          rules={[{ required: true, message: '请输入客户机用户名' }]}
        >
          <Input placeholder="Administrator / root" />
        </Form.Item>
        <Form.Item
          label="Guest 密码"
          name="password"
          rules={
            hasExistingAssignment
              ? []
              : [{ required: true, message: '请输入客户机密码' }]
          }
          extra={
            hasExistingAssignment
              ? '留空表示不修改已保存的 Guest 密码'
              : '写入云桌面网关连接配置，供云桌面用户远程登录'
          }
        >
          <Input.Password placeholder={hasExistingAssignment ? '留空则不修改' : '请输入客户机密码'} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VmAssignDesktopUsersModal;
