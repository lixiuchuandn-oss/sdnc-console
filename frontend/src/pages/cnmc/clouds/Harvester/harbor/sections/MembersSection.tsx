/**
 * 项目成员管理 Section
 * 
 * 展示项目成员列表，支持添加、删除成员
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Space, Tag, Input, Modal, Form, Select, App, Empty } from 'antd';
import { 
  PlusOutlined, 
  ReloadOutlined, 
  SearchOutlined,
  UserOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { HarborProjectMember } from '../types';
import { 
  getHarborProjectMembers, 
  addHarborProjectMember, 
  deleteHarborProjectMember 
} from '../shared/harborApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';

interface Props {
  harborId: string;
  projectName: string;
}

/**
 * 角色映射
 */
const ROLE_MAP: Record<number, { name: string; color: string }> = {
  1: { name: '只读', color: 'default' },
  2: { name: '开发者', color: 'blue' },
  3: { name: '管理员', color: 'orange' },
  4: { name: '项目管理员', color: 'red' },
};

const MembersSection: React.FC<Props> = ({ harborId, projectName }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<HarborProjectMember[]>([]);
  const [keyword, setKeyword] = useState('');
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [form] = Form.useForm();

  /**
   * 加载成员列表
   */
  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHarborProjectMembers(harborId, projectName);
      setMembers(Array.isArray(res) ? res : []);
    } catch (e: any) {
      console.error('加载成员列表失败:', e);
      message.error(e?.message || '加载成员列表失败');
    } finally {
      setLoading(false);
    }
  }, [harborId, projectName, message]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  /**
   * 添加成员
   */
  const handleAddMember = useCallback(async (values: { username: string; roleId: number }) => {
    try {
      await addHarborProjectMember(harborId, projectName, {
        username: values.username,
        roleId: values.roleId,
      });
      message.success('成员添加成功');
      setAddModalVisible(false);
      form.resetFields();
      loadMembers();
    } catch (e: any) {
      message.error(e?.message || '添加成员失败');
    }
  }, [harborId, projectName, message, form, loadMembers]);

  /**
   * 删除成员
   */
  const handleDeleteMember = useCallback((member: HarborProjectMember) => {
    void confirmHighRiskDelete({
      resourceLabel: '项目成员',
      name: member.entityName,
      description: `确定要移除成员 "${member.entityName}" 吗？`,
      riskItems: DELETE_RISK_ITEMS,
      onConfirm: async () => {
        try {
          await deleteHarborProjectMember(harborId, projectName, member.id);
          message.success('成员已移除');
          loadMembers();
        } catch (e: any) {
          message.error(e?.message || '删除成员失败');
        }
      },
    }).catch(() => {});
  }, [harborId, projectName, message, loadMembers]);

  /**
   * 表格列定义
   */
  const columns = [
    {
      title: '成员名称',
      dataIndex: 'entityName',
      key: 'entityName',
      render: (name: string, record: HarborProjectMember) => (
        <Space>
          {record.entityType === 'u' ? (
            <UserOutlined style={{ color: '#1890ff' }} />
          ) : (
            <TeamOutlined style={{ color: '#52c41a' }} />
          )}
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'entityType',
      key: 'entityType',
      width: 100,
      render: (type: string) => (
        <Tag color={type === 'u' ? 'blue' : 'green'}>
          {type === 'u' ? '用户' : '用户组'}
        </Tag>
      ),
    },
    {
      title: '角色',
      dataIndex: 'roleId',
      key: 'roleId',
      width: 120,
      render: (roleId: number) => {
        const role = ROLE_MAP[roleId];
        return (
          <Tag color={role?.color || 'default'}>
            {role?.name || `角色 ${roleId}`}
          </Tag>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: HarborProjectMember) => {
        // admin 用户不可移除（Harbor 原生行为）
        if (record.entityName === 'admin') {
          return null;
        }
        const items = [
          {
            key: 'delete',
            label: '移除',
            danger: true,
            onClick: () => handleDeleteMember(record),
          },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];

  // 搜索过滤
  const filteredMembers = members.filter((m) =>
    m.entityName.toLowerCase().includes(keyword.toLowerCase()),
  );

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Input
            placeholder="搜索成员名称"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
        </Space>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalVisible(true)}>
            添加成员
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadMembers} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 成员列表 */}
      <Card size="small">
        <Table
          columns={columns}
          dataSource={filteredMembers}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showTotal: (t) => `共 ${t} 个成员`,
          }}
          locale={{
            emptyText: <Empty description="暂无成员" />,
          }}
        />
      </Card>

      {/* 添加成员弹窗 */}
      <Modal
        title="添加成员"
        open={addModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setAddModalVisible(false);
          form.resetFields();
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddMember}
          initialValues={{ roleId: 2 }}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
            ]}
          >
            <Input placeholder="输入用户名或用户组名称" />
          </Form.Item>
          <Form.Item
            name="roleId"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { label: '只读 - 只能查看项目资源', value: 1 },
                { label: '开发者 - 可推送和拉取镜像', value: 2 },
                { label: '管理员 - 可管理项目配置', value: 3 },
                { label: '项目管理员 - 完全控制权限', value: 4 },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MembersSection;
