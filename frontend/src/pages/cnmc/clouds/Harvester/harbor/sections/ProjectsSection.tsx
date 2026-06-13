/**
 * Harbor 项目管理 Section
 *
 * 展示 Harbor 项目列表，支持创建、删除项目
 * 支持租户关联和项目隔离功能
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, Card, Button, Space, Tag, Input, Modal, Form, Select, App, Empty, Alert } from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import type { HarborRegistry, HarborProjectForm } from '../types';
import type { HarborProjectWithTenant } from '../types';
import { getHarborProjects, createHarborProject, deleteHarborProject } from '../shared/harborApi';
import { isHarborProjectPublic } from '../shared/projectVisibility';
import { getApiErrorMessage } from '../../../../../../services/api';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import { useAuth } from '../../../../../../contexts/AuthContext';

interface Props {
  harbor: HarborRegistry;
  onViewProject?: (project: HarborProjectWithTenant) => void;
}

const ProjectsSection: React.FC<Props> = ({ harbor, onViewProject }) => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<HarborProjectWithTenant[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();

  // 判断当前用户是否为系统管理员
  const isSystemAdmin = useMemo(() => {
    const role = (user as any)?.role;
    return role === 'super_admin' || role === 'admin';
  }, [user]);

  // 判断是否为平台内置 Harbor
  const isBuiltInHarbor = harbor.isBuiltIn;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHarborProjects(harbor.id, {
        page: 1,
        pageSize: 100,
        q: keyword || undefined,
      });
      const list = Array.isArray(res) ? res : (res?.data || []);
      setProjects(list);
      setTotal(Array.isArray(res) ? res.length : (res?.total || 0));
    } catch (e: any) {
      console.error('加载项目列表失败:', e);
      message.error(e?.message || '加载项目列表失败');
    } finally {
      setLoading(false);
    }
  }, [harbor.id, keyword, message]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreate = useCallback(
    async (values: HarborProjectForm) => {
      try {
        await createHarborProject(harbor.id, values);
        message.success('项目创建成功');
        setCreateModalVisible(false);
        form.resetFields();
        loadProjects();
      } catch (e: any) {
        message.error(e?.message || '创建项目失败');
      }
    },
    [harbor.id, message, form, loadProjects],
  );

  // 判断是否可删除项目
  const canDeleteProject = useCallback(
    (project: HarborProjectWithTenant) => {
      // 系统管理员可以删除任何项目
      if (user?.role === 'super_admin' || user?.role === 'admin') return true;
      // 用户自建 Harbor，允许删除
      if (!isBuiltInHarbor) return true;
      // 平台内置 Harbor：
      // 1. 项目管理员（role_id=1）可删除
      // 2. 项目创建者（isOwner=true）可删除
      const canDelete = project.currentUserRole === 1 || project.isOwner === true;
      return canDelete;
    },
    [isBuiltInHarbor, user?.role],
  );

  const handleDelete = useCallback(
    (project: HarborProjectWithTenant) => {
      // 权限校验
      if (!canDeleteProject(project)) {
        message.error('只有项目管理员才能删除项目');
        return;
      }

      void confirmHighRiskDelete({
        resourceLabel: '项目',
        name: project.name,
        description: `确定要删除项目 "${project.name}" 吗？删除后不可恢复。`,
        riskItems: DELETE_RISK_ITEMS,
        onConfirm: async () => {
          if ((project.repoCount ?? 0) > 0) {
            message.error(
              `无法删除项目「${project.name}」：项目下仍有 ${project.repoCount} 个镜像仓库。请先进入该项目，删除全部仓库与镜像后再试。`,
            );
            return;
          }
          try {
            await deleteHarborProject(harbor.id, project);
            message.success('项目已删除');
            loadProjects();
          } catch (e: unknown) {
            message.error(getApiErrorMessage(e, '删除项目失败'));
          }
        },
      }).catch(() => {});
    },
    [harbor.id, message, loadProjects, canDeleteProject],
  );

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: HarborProjectWithTenant) => (
        <a onClick={() => onViewProject?.(record)}>{name}</a>
      ),
    },
    {
      title: '所属租户',
      dataIndex: 'tenantId',
      key: 'tenantId',
      width: 150,
      render: (tenantId: string | undefined, record: HarborProjectWithTenant) => {
        if (record.public) {
          return <Tag color="green">公共项目</Tag>;
        }
        if (tenantId) {
          return <span>{record.tenantName || tenantId}</span>;
        }
        return <Tag color="default">未关联</Tag>;
      },
    },
    {
      title: '访问级别',
      key: 'public',
      width: 120,
      render: (_: any, record: HarborProjectWithTenant) => {
        const isPublic = isHarborProjectPublic(record);
        return (
          <Tag color={isPublic ? 'green' : 'blue'} icon={isPublic ? <UnlockOutlined /> : <LockOutlined />}>
            {isPublic ? '公开' : '私有'}
          </Tag>
        );
      },
    },
    {
      title: '我的角色',
      dataIndex: 'currentUserRole',
      key: 'currentUserRole',
      width: 120,
      render: (roleId: number | undefined) => {
        const roleMap: Record<number, { name: string; color: string }> = {
          1: { name: '只读', color: 'default' },
          2: { name: '开发者', color: 'blue' },
          3: { name: '管理员', color: 'orange' },
          4: { name: '项目管理员', color: 'red' },
        };
        const role = roleId ? roleMap[roleId] : undefined;
        return role ? <Tag color={role.color}>{role.name}</Tag> : '-';
      },
    },
    {
      title: '仓库数量',
      dataIndex: 'repoCount',
      key: 'repoCount',
      width: 100,
      render: (count: number) => count || 0,
    },
    {
      title: '所有者',
      dataIndex: 'ownerName',
      key: 'ownerName',
      width: 120,
      render: (owner: string) => owner || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (time: string) => (time ? new Date(time).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: HarborProjectWithTenant) => {
        const items: any[] = [
          {
            key: 'repositories',
            label: '查看详情',
            onClick: () => onViewProject?.(record),
          },
        ];
        // 只有有权限的用户才显示删除按钮
        if (canDeleteProject(record)) {
          items.push({
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => handleDelete(record),
          });
        }
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Input
            placeholder="搜索项目名称"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={loadProjects}
            style={{ width: 200 }}
            allowClear
          />
        </Space>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
            创建项目
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadProjects} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <Card size="small">
        <Table
          columns={columns}
          dataSource={projects}
          rowKey="projectId"
          loading={loading}
          pagination={{
            total,
            pageSize: 10,
            showTotal: (t) => `共 ${t} 个项目`,
          }}
          locale={{
            emptyText: <Empty description="暂无项目" />,
          }}
        />
      </Card>

      <Modal
        title="创建项目"
        open={createModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
      >
        {!isSystemAdmin && isBuiltInHarbor && (
          <Alert
            message="租户用户只能创建私有项目"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ public: 0 }}>
          <Form.Item
            name="projectName"
            label="项目名称"
            rules={[
              { required: true, message: '请输入项目名称' },
              { pattern: /^[a-z0-9][-a-z0-9]*$/, message: '只能包含小写字母、数字和连字符' },
            ]}
          >
            <Input placeholder="例如：my-project" />
          </Form.Item>
          <Form.Item name="public" label="访问级别">
            <Select
              options={[
                ...(isSystemAdmin ? [{ label: '公开（所有租户可访问）', value: 1 }] : []),
                { label: '私有（仅项目成员可访问）', value: 0 },
              ]}
              disabled={!isSystemAdmin && isBuiltInHarbor}
            />
          </Form.Item>
          <Form.Item name="storageLimit" label="存储配额（GB）">
            <Input type="number" placeholder="不限制" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProjectsSection;
