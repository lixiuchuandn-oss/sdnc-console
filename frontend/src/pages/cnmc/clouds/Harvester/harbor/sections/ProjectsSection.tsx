/**
 * Harbor 项目管理 Section
 *
 * 展示 Harbor 项目列表，支持创建、编辑、删除项目
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Space, Tag, Input, Modal, Form, Select, App, Empty } from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import type { HarborRegistry, HarborProject, HarborProjectForm } from '../types';
import { getHarborProjects, createHarborProject, deleteHarborProject } from '../shared/harborApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';

interface Props {
  harbor: HarborRegistry;
  onViewProject?: (project: HarborProject) => void;
}

const ProjectsSection: React.FC<Props> = ({ harbor, onViewProject }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<HarborProject[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();

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

  const handleDelete = useCallback(
    (project: HarborProject) => {
      void confirmHighRiskDelete({
        resourceLabel: '项目',
        name: project.name,
        description: `确定要删除项目 "${project.name}" 吗？删除后不可恢复。`,
        riskItems: DELETE_RISK_ITEMS,
        onConfirm: async () => {
          try {
            await deleteHarborProject(harbor.id, project.name);
            message.success('项目已删除');
            loadProjects();
          } catch (e: any) {
            message.error(e?.message || '删除项目失败');
          }
        },
      }).catch(() => {});
    },
    [harbor.id, message, loadProjects],
  );

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: HarborProject) => (
        <a onClick={() => onViewProject?.(record)}>{name}</a>
      ),
    },
    {
      title: '访问级别',
      key: 'public',
      width: 120,
      render: (_: any, record: HarborProject) => {
        const isPublic = record.metadata?.public === 'public';
        return (
          <Tag color={isPublic ? 'green' : 'blue'} icon={isPublic ? <UnlockOutlined /> : <LockOutlined />}>
            {isPublic ? '公开' : '私有'}
          </Tag>
        );
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
      render: (_: any, record: HarborProject) => {
        const items = [
          {
            key: 'repositories',
            label: '查看详情',
            onClick: () => onViewProject?.(record),
          },
          {
            key: 'edit',
            label: '编辑',
            onClick: () => message.info('编辑功能开发中'),
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => handleDelete(record),
          },
        ];
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
                { label: '私有（仅项目成员可访问）', value: 0 },
                { label: '公开（所有人可访问）', value: 1 },
              ]}
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
