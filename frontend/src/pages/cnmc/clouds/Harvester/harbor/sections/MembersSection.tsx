/**
 * 项目成员管理 Section
 * 
 * 展示项目成员列表，支持添加、编辑角色、删除成员
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Space, Tag, Input, Modal, Form, Select, App, Empty } from 'antd';
import { 
  PlusOutlined, 
  ReloadOutlined, 
  SearchOutlined,
  UserOutlined,
  TeamOutlined,
  EditOutlined,
} from '@ant-design/icons';
import type { 
  HarborProjectMemberWithUser,
  HarborTenantUser,
  HarborUserMapping,
  HarborRegistry,
} from '../types';
import type { HarborProjectRef } from '../shared/harborApi';
import { 
  getHarborProjectMembers, 
  addHarborProjectMemberByTenantUser,
  updateHarborProjectMemberRole,
  deleteHarborProjectMember,
  getHarborTenantUsers,
  checkHarborUserMapping,
} from '../shared/harborApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';

interface Props {
  harborId: string;
  project: HarborProjectRef;
  /** Harbor 实例配置（用于判断是否为内置 Harbor） */
  harborRegistry?: HarborRegistry;
  /** 当前用户是否为项目管理员 */
  isProjectAdmin?: boolean;
}

/**
 * 角色映射（根据 Harbor API 实际返回）
 * - role_id=1 → 项目管理员（projectAdmin）
 * - role_id=2 → 开发者（developer）
 * - role_id=3 → 访客（guest）
 * - role_id=4 → 维护人员（maintainer）
 * - role_id=5 → 受限访客（limitedGuest）
 */
const ROLE_MAP: Record<number, { name: string; color: string }> = {
  1: { name: '项目管理员', color: 'red' },
  2: { name: '开发者', color: 'blue' },
  3: { name: '访客', color: 'default' },
  4: { name: '维护人员', color: 'orange' },
  5: { name: '受限访客', color: 'default' },
};

const MembersSection: React.FC<Props> = ({ 
  harborId, 
  project, 
  harborRegistry,
  isProjectAdmin = false,
}) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<HarborProjectMemberWithUser[]>([]);
  const [keyword, setKeyword] = useState('');
  
  // 添加成员弹窗
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [tenantUsers, setTenantUsers] = useState<HarborTenantUser[]>([]);
  const [selectedUserMapping, setSelectedUserMapping] = useState<{ exists: boolean; mapping?: HarborUserMapping } | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  
  // 编辑角色弹窗
  const [editRoleModalVisible, setEditRoleModalVisible] = useState(false);
  const [editingMember, setEditingMember] = useState<HarborProjectMemberWithUser | null>(null);
  const [editRoleForm] = Form.useForm();
  
  // 判断是否可以管理成员（仅内置 Harbor 且为项目管理员）
  const canManageMembers = harborRegistry?.isBuiltIn && isProjectAdmin;

  /**
   * 加载成员列表
   */
  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHarborProjectMembers(harborId, project);
      setMembers(Array.isArray(res) ? res : []);
    } catch (e: any) {
      console.error('加载成员列表失败:', e);
      message.error(e?.message || '加载成员列表失败');
    } finally {
      setLoading(false);
    }
  }, [harborId, project, message]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  /**
   * 加载租户用户列表
   */
  const loadTenantUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const users = await getHarborTenantUsers(harborId);
      setTenantUsers(users || []);
    } catch (e: any) {
      console.error('加载用户列表失败:', e);
      message.error(e?.message || '加载用户列表失败');
    } finally {
      setLoadingUsers(false);
    }
  }, [harborId, message]);

  /**
   * 打开添加成员弹窗
   */
  const handleOpenAddModal = useCallback(() => {
    setAddModalVisible(true);
    loadTenantUsers();
  }, [loadTenantUsers, members]);

  /**
   * 用户选择处理
   */
  const handleUserSelect = useCallback(async (userId: string) => {
    if (!userId) {
      setSelectedUserMapping(null);
      return;
    }
    
    try {
      const result = await checkHarborUserMapping(harborId, userId);
      setSelectedUserMapping(result);
    } catch (e: any) {
      console.error('检查用户映射失败:', e);
      message.error(e?.message || '检查用户映射失败');
    }
  }, [harborId, message]);

  /**
   * 添加成员
   */
  const handleAddMember = useCallback(async (values: { tenantUserId: string; harborPassword?: string; roleId: number }) => {
    try {
      await addHarborProjectMemberByTenantUser(harborId, project, {
        tenantUserId: values.tenantUserId,
        harborPassword: values.harborPassword,
        role: values.roleId,
      });
      message.success('成员添加成功');
      setAddModalVisible(false);
      form.resetFields();
      setSelectedUserMapping(null);
      loadMembers();
    } catch (e: any) {
      message.error(e?.message || '添加成员失败');
    }
  }, [harborId, project, message, form, loadMembers]);

  /**
   * 编辑角色
   */
  const handleEditRole = useCallback((member: HarborProjectMemberWithUser) => {
    setEditingMember(member);
    editRoleForm.setFieldsValue({ roleId: member.roleId });
    setEditRoleModalVisible(true);
  }, [editRoleForm]);

  /**
   * 更新角色
   */
  const handleUpdateRole = useCallback(async (values: { roleId: number }) => {
    if (!editingMember) return;
    try {
      await updateHarborProjectMemberRole(harborId, project, editingMember.id, {
        roleId: values.roleId,
      });
      message.success('角色更新成功');
      setEditRoleModalVisible(false);
      setEditingMember(null);
      loadMembers();
    } catch (e: any) {
      message.error(e?.message || '更新角色失败');
    }
  }, [harborId, project, editingMember, message, loadMembers]);

  /**
   * 删除成员
   */
  const handleDeleteMember = useCallback((member: HarborProjectMemberWithUser) => {
    void confirmHighRiskDelete({
      resourceLabel: '项目成员',
      name: member.entityName,
      description: `确定要移除成员 "${member.entityName}" 吗？`,
      riskItems: DELETE_RISK_ITEMS,
      onConfirm: async () => {
        try {
          await deleteHarborProjectMember(harborId, project, member.id);
          message.success('成员已移除');
          loadMembers();
        } catch (e: any) {
          message.error(e?.message || '删除成员失败');
        }
      },
    }).catch(() => {});
  }, [harborId, project, message, loadMembers]);

  /**
   * 表格列定义
   */
  const columns = [
    {
      title: '成员名称',
      dataIndex: 'entityName',
      key: 'entityName',
      render: (name: string, record: HarborProjectMemberWithUser) => {
        // 如果有 Tower 用户信息，显示详细信息
        if (record.towerUser) {
          return (
            <Space direction="vertical" size={0}>
              <Space size={4}>
                {record.entityType === 'u' ? (
                  <UserOutlined style={{ color: '#1890ff' }} />
                ) : (
                  <TeamOutlined style={{ color: '#52c41a' }} />
                )}
                <span>{record.towerUser.fullName || record.towerUser.username}</span>
              </Space>
              <span style={{ fontSize: 12, color: '#999', paddingLeft: 20 }}>
                {record.towerUser.organization?.name || '未分配组织'}
              </span>
            </Space>
          );
        }
        // 否则显示原有信息
        return (
          <Space>
            {record.entityType === 'u' ? (
              <UserOutlined style={{ color: '#1890ff' }} />
            ) : (
              <TeamOutlined style={{ color: '#52c41a' }} />
            )}
            <span>{name}</span>
          </Space>
        );
      },
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
      width: 120,
      render: (_: any, record: HarborProjectMemberWithUser) => {
        // admin 用户不可操作（Harbor 原生行为）
        if (record.entityName === 'admin') {
          return null;
        }
        
        const items = [
          {
            key: 'edit-role',
            label: '编辑角色',
            icon: <EditOutlined />,
            onClick: () => handleEditRole(record),
          },
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
  const filteredMembers = members.filter((m) => {
    const keywordLower = keyword.toLowerCase();
    // 搜索成员名称
    if (m.entityName.toLowerCase().includes(keywordLower)) return true;
    // 搜索 Tower 用户信息
    if (m.towerUser) {
      if (m.towerUser.fullName?.toLowerCase().includes(keywordLower)) return true;
      if (m.towerUser.username?.toLowerCase().includes(keywordLower)) return true;
      if (m.towerUser.organization?.name?.toLowerCase().includes(keywordLower)) return true;
    }
    return false;
  });

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
          {canManageMembers && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAddModal}>
              添加成员
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={loadMembers} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 非内置 Harbor 提示 */}
      {!harborRegistry?.isBuiltIn && (
        <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4 }}>
          <span style={{ color: '#d48806' }}>
            外部 Harbor 不支持通过 Tower 管理成员，请在 Harbor 控制台中操作
          </span>
        </div>
      )}

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
          setSelectedUserMapping(null);
        }}
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddMember}
          initialValues={{ roleId: 2 }}
        >
          <Form.Item
            name="tenantUserId"
            label="选择用户"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select
              showSearch
              placeholder="搜索并选择用户"
              loading={loadingUsers}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={tenantUsers
                .filter(u => {
                  const isMember = members.some(m => m.towerUser?.id === u.id);
                  if (isMember) {
                    // 已在项目中的用户无需再次添加
                  }
                  return !isMember;
                })
                .map(u => ({
                  label: `${u.fullName || u.username} (${u.organization?.path?.join(' > ') || u.organization?.name || '未分配组织'})`,
                  value: u.id,
                }))}
              onChange={handleUserSelect}
            />
          </Form.Item>
          
          {/* 首次添加时显示密码设置字段 */}
          {!selectedUserMapping?.exists && (
            <Form.Item
              name="harborPassword"
              label="Harbor 密码"
              rules={[{ required: true, message: '请为该用户设置 Harbor 登录密码' }]}
              extra="该用户首次添加到 Harbor，需要设置登录密码"
            >
              <Input.Password placeholder="设置 Harbor 登录密码" />
            </Form.Item>
          )}
          
          {/* 用户已有映射时的提示 */}
          {selectedUserMapping?.exists && (
            <div style={{ marginBottom: 16, padding: '8px 12px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 4 }}>
              <span style={{ color: '#0958d9' }}>
                该用户已有 Harbor 账户，将直接添加到项目中
              </span>
            </div>
          )}
          
          <Form.Item
            name="roleId"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { label: '项目管理员 - 完全控制权限', value: 1 },
                { label: '开发者 - 可推送和拉取镜像', value: 2 },
                { label: '访客 - 只能查看项目资源', value: 3 },
                { label: '维护人员 - 维护和镜像管理', value: 4 },
                { label: '受限访客 - 最小权限', value: 5 },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑角色弹窗 */}
      <Modal
        title="编辑角色"
        open={editRoleModalVisible}
        onOk={() => editRoleForm.submit()}
        onCancel={() => {
          setEditRoleModalVisible(false);
          setEditingMember(null);
        }}
        width={440}
      >
        <Form
          form={editRoleForm}
          layout="vertical"
          onFinish={handleUpdateRole}
        >
          <Form.Item label="成员名称">
            <Space>
              {editingMember?.entityType === 'u' ? (
                <UserOutlined style={{ color: '#1890ff' }} />
              ) : (
                <TeamOutlined style={{ color: '#52c41a' }} />
              )}
              <span>
                {editingMember?.towerUser?.fullName || editingMember?.towerUser?.username || editingMember?.entityName}
              </span>
              {editingMember?.towerUser && (
                <span style={{ fontSize: 12, color: '#999' }}>
                  ({editingMember.towerUser.organization?.name || '未分配组织'})
                </span>
              )}
            </Space>
          </Form.Item>
          
          <Form.Item
            name="roleId"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { label: '项目管理员 - 完全控制权限', value: 1 },
                { label: '开发者 - 可推送和拉取镜像', value: 2 },
                { label: '访客 - 只能查看项目资源', value: 3 },
                { label: '维护人员 - 维护和镜像管理', value: 4 },
                { label: '受限访客 - 最小权限', value: 5 },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MembersSection;
