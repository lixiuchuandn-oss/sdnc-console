/**
 * @file TemplatesSection.tsx
 * @description Harvester VM 模板列表视图
 *
 * 职责说明：
 * - 以表格形式展示 Harvester 中的虚拟机模板（名称、命名空间、描述、创建时间）
 * - 提供基于名称 / 命名空间的关键字搜索
 * - 支持表格列显示配置（通过 TableColumnSettings 记住用户偏好）
 * - 支持触发上层传入的刷新回调 onRefresh，用于重新拉取模板列表
 *
 * 集成说明：
 * - 组件本身是一个“轻量视图”，只负责展示与简单筛选，不直接调用后端 API
 * - 模板列表数据 templates、加载状态 loading 以及刷新函数 onRefresh 由上层 Harvester 页面注入
 */

import React, { useState, useMemo } from 'react';
import { Table, Input, Button, Checkbox, Select, Modal, message, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, DeleteOutlined, SearchOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import HarvesterTemplateDetailDrawer from '../components/HarvesterTemplateDetailDrawer';
import HarvesterOpsinfoDrawer from '../components/HarvesterOpsinfoDrawer';
import { isSystemNamespace, isPublicNamespace } from '../../../../utils/harvesterUtils';
import { deleteHarvesterResourceByLink } from '../../../../services/harvesterApi';

/**
 * Props 定义
 *
 * @property cloudId    当前云平台 ID（此处仅透传占位，方便后续扩展操作）
 * @property templates  Harvester 返回的模板列表（VirtualMachineTemplate 数组）
 * @property loading    外层传入的加载状态，用于控制表格和刷新按钮的 loading
 * @property onRefresh  触发上层重新拉取模板列表的回调，支持 force 参数
 */
interface Props {
  cloudId: string;
  templates: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean; // 是否为租户模式
}

const getTemplateNamespace = (tpl: any): string =>
  tpl?.metadata?.namespace || tpl?.namespace || '';

const getTemplateName = (tpl: any): string =>
  tpl?.metadata?.name || tpl?.name || '';

const getTemplateDescription = (tpl: any): string =>
  tpl?.spec?.description || tpl?.metadata?.annotations?.description || '';

const getTemplateDisplayName = (tpl: any): string =>
  tpl?.spec?.displayName ||
  tpl?.metadata?.annotations?.['tower.io/template-alias'] ||
  tpl?.metadata?.annotations?.['field.cattle.io/displayName'] ||
  tpl?.metadata?.annotations?.['tower.io/alias'] ||
  getTemplateName(tpl);

const getTemplateAlias = (tpl: any): string =>
  tpl?.spec?.displayName ||
  tpl?.metadata?.annotations?.['tower.io/template-alias'] ||
  tpl?.metadata?.annotations?.['field.cattle.io/displayName'] ||
  tpl?.metadata?.annotations?.['tower.io/alias'] ||
  '';

const getTemplateScope = (tpl: any): '公共模板' | '私有模板' => {
  const ns = getTemplateNamespace(tpl);
  return isPublicNamespace(ns) ? '公共模板' : '私有模板';
};

/**
 * TemplatesSection 组件
 *
 * 用途：
 * - 展示 Harvester VM 模板列表
 * - 提供简单的前端搜索过滤能力
 * - 提供列设置和刷新按钮
 *
 * 说明：
 * - 此组件本身不直接调用后端，只消费上层传入的数据和回调
 */
const TemplatesSection: React.FC<Props> = ({ 
  cloudId, 
  templates = [], 
  loading, 
  onRefresh, 
  isTenant = false,
}) => {
  const { modal } = App.useApp();
  // [状态] 控制系统资源显示的开关 (默认关闭)
  const [showSystemResources, setShowSystemResources] = useState<boolean>(false);
  
  // [推导] 视图控制变量
  const bordered = !isTenant; // 租户模式无边框
  const showYaml = !isTenant; // 租户模式不显示 YAML

  /**
   * 搜索关键字（受控 Input）
   * - 用户在顶部输入框中输入的文本
   * - 用于在前端过滤模板列表（按名称 / 命名空间模糊匹配）
   */
  const [searchText, setSearchText] = useState('');
  // 命名空间筛选状态
  const [selectedNamespace, setSelectedNamespace] = useState<string | undefined>(undefined);
  // 作用域筛选状态：all/public/private
  const [selectedScope, setSelectedScope] = useState<'all' | 'public' | 'private'>('all');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [opsInfoVisible, setOpsInfoVisible] = useState(false);
  const [opsInfoRecord, setOpsInfoRecord] = useState<any>(null);
  const [opsInfoActiveTab, setOpsInfoActiveTab] = useState('detail');
  const navigate = useNavigate();
  const location = useLocation();

  const handleDelete = async (tpl: any) => {
    const ns = getTemplateNamespace(tpl);
    const name = getTemplateName(tpl);
    
    modal.confirm({
      title: '确认删除模板？',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除模板 ${name} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          // Template Path: /apis/harvesterhci.io/v1beta1/namespaces/{ns}/virtualmachinetemplates/{name}
          const path = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
          await deleteHarvesterResourceByLink(cloudId, path);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      }
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;

    modal.confirm({
      title: '确认批量删除模板？',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除选中的 ${selectedRowKeys.length} 个模板吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const promises = selectedRowKeys.map(async (key) => {
            const tpl = templates.find(t => (t.metadata?.uid || t.metadata?.name) === key);
            if (!tpl) return;
            const ns = getTemplateNamespace(tpl);
            const name = getTemplateName(tpl);
            const path = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
            await deleteHarvesterResourceByLink(cloudId, path);
          });
          
          await Promise.all(promises);
          message.success('批量删除指令已发送');
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`批量删除失败: ${e.message}`);
        }
      }
    });
  };

  const handleCreateFromTemplate = (tpl: any) => {
    if (!tpl) return;
    const ns = getTemplateNamespace(tpl);
    const name = getTemplateName(tpl);
    navigate(`/clouds/${cloudId}/instances/create`, {
      state: {
        backgroundLocation: location,
        fromTemplate: { namespace: ns, name, template: tpl },
      },
    });
  };

  const handleOpenDrawer = (tpl: any) => {
    if (!tpl) return;
    const r = { ...tpl, kind: tpl?.kind || 'VirtualMachineTemplate' };
    setDetailRecord(r);
    setDetailVisible(true);
  };

  const handleOpenOpsInfo = (tpl: any) => {
    if (!tpl) return;
    const ns = getTemplateNamespace(tpl);
    const name = getTemplateName(tpl);
    // 构造 view link 用于 HarvesterOpsinfoDrawer 获取实时数据
    // Template 路径: /apis/harvesterhci.io/v1beta1/namespaces/{ns}/virtualmachinetemplates/{name}
    const viewLink = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
    
    const r = { 
        ...tpl, 
        kind: tpl?.kind || 'VirtualMachineTemplate',
        links: {
            ...(tpl?.links || {}),
            view: viewLink
        }
    };
    console.log('Opening OpsInfo for template:', r);
    setOpsInfoRecord(r);
    setOpsInfoActiveTab('detail');
    setOpsInfoVisible(true);
  };
  
  /**
   * 表格列定义（allColumns）
   *
   * 特点：
   * - 使用 useMemo 避免每次渲染都重新创建列定义
   * - 不依赖外部状态，因此依赖数组为空 []
   *
   * 列说明：
   * - 名称：显示模板的 metadata.name
   * - 命名空间：显示模板所在的 Namespace
   * - 描述：显示模板 spec.description
   * - 创建时间：显示 metadata.creationTimestamp
   * - 操作：目前为占位文案“暂无操作”，后续可扩展
   */
  const allColumns = useMemo<ColumnsType<any>>(
    () => [
    {
      title: '名称',
      key: 'name',
      render: (_: any, r: any) => (
        <span className="cell-link" onClick={() => { handleOpenDrawer(r); }}>
          {getTemplateName(r)}
        </span>
      )
    },
    {
      title: '别名',
      key: 'alias',
      render: (_: any, r: any) => getTemplateAlias(r) || '-'
    },
    {
      title: '作用域',
      key: 'scope',
      render: (_: any, r: any) => getTemplateScope(r)
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => getTemplateNamespace(r) || '-'
    },
    {
      title: '描述',
      key: 'description',
      render: (_: any, r: any) => getTemplateDescription(r) || '-'
    },
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      sorter: (a: any, b: any) => {
        const t1 = a.metadata?.creationTimestamp || '';
        const t2 = b.metadata?.creationTimestamp || '';
        return t1.localeCompare(t2);
      },
      render: (_: any, r: any) => {
        const t = r.metadata?.creationTimestamp;
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, r: any) => {
        const items: any[] = [
          {
            key: 'create_vm',
            label: '创建虚拟机',
            onClick: () => handleCreateFromTemplate(r),
          },
          {
            key: 'detail',
            label: '资源详情',
            onClick: () => { handleOpenDrawer(r); },
          }
        ];

        // 仅在非租户模式下显示运维信息
        if (!isTenant) {
          items.push({
            key: 'ops_info',
            label: '运维信息',
            onClick: () => { handleOpenOpsInfo(r); },
          });
        }

        items.push(
          { type: 'divider' as const },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => handleDelete(r),
          }
        );

        return (
          <ResourceActionsDropdown
            items={items}
            buttonProps={{ 
              className: 'row-actions-trigger',
              style: { margin: 0 } 
            }}
          />
        );
      },
    }
  ],
    [isTenant, showYaml],
  );

  /**
   * 当前表格实际使用的列配置
   *
   * - 初始值为 allColumns
   * - 通过 TableColumnSettings 组件的 onChange 回调更新
   * - 用户可以在 UI 中选择显示/隐藏列，这里保存用户的选择结果
   */
  const [tableColumns, setTableColumns] = useState<ColumnsType<any>>(allColumns);

  /**
   * 基础数据（过滤系统资源/租户权限）
   */
  const baseData = useMemo(() => {
    return templates.filter((t: any) => {
      const ns = getTemplateNamespace(t);
      if (isTenant) {
        return true;
      }
      // 管理员模式：根据开关决定是否显示系统命名空间
      if (!showSystemResources && isSystemNamespace(ns)) return false;
      return true;
    });
  }, [templates, isTenant, showSystemResources]);

  /**
   * 命名空间选项
   */
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    baseData.forEach((t: any) => {
      const ns = getTemplateNamespace(t);
      if (ns) nsSet.add(ns);
    });
    return Array.from(nsSet).map(ns => ({ value: ns, label: ns }));
  }, [baseData]);

  /**
   * 最终展示的数据（filteredData）
   *
   * 过滤逻辑：
   * - 基于 baseData
   * - 应用命名空间筛选
   * - 应用名称关键字搜索
   */
  const filteredData = useMemo(() => {
    return baseData.filter((t: any) => {
      // 1. 命名空间筛选
      const ns = getTemplateNamespace(t);
      if (selectedNamespace && ns !== selectedNamespace) return false;
      // 1.1 作用域筛选
      if (selectedScope === 'public' && !isPublicNamespace(ns)) return false;
      if (selectedScope === 'private' && isPublicNamespace(ns)) return false;

      // 2. 关键字搜索（仅搜索名称）
      if (searchText) {
        const lower = searchText.toLowerCase();
        return getTemplateDisplayName(t).toLowerCase().includes(lower);
      }
      
      return true;
    });
  }, [baseData, searchText, selectedNamespace, selectedScope]);

  return (
      <PageDetailSection
        toolbarLeft={(
          <>
            <Input
              placeholder="关键字"
              suffix={<SearchOutlined />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="toolbar-search"
              allowClear
            />
            {!isTenant && (
              <Select
                allowClear
                showSearch
                placeholder="命名空间"
                value={selectedNamespace}
                onChange={setSelectedNamespace}
                options={namespaceOptions}
                className="toolbar-filter"
              />
            )}
            <Select
              allowClear
              placeholder="作用域"
              value={selectedScope === 'all' ? undefined : selectedScope}
              onChange={(val) => setSelectedScope((val as any) || 'all')}
              options={[
                { value: 'public', label: '公共模板' },
                { value: 'private', label: '私有模板' },
              ]}
              className="toolbar-filter-sm"
            />
            {!isTenant && (
              <Checkbox
                checked={showSystemResources}
                onChange={e => setShowSystemResources(e.target.checked)}
              >
                显示系统资源
              </Checkbox>
            )}
            <a 
              className="toolbar-reset-btn" 
              onClick={() => {
                setSearchText('');
                setSelectedNamespace(undefined);
                setSelectedScope('all');
              }}
            >
              重置
            </a>
          </>
        )}
        toolbarRight={(
          <>
            {selectedRowKeys.length > 0 && (
              <Button 
                danger
                icon={<DeleteOutlined />} 
                onClick={handleBatchDelete}
                style={{ marginRight: 8 }}
              >
                批量删除
              </Button>
            )}
            <TableColumnSettings
              columns={allColumns}
              onChange={setTableColumns}
              settingsKey="harvester_templates_table"
            />
            {onRefresh && (
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => onRefresh?.(true)} 
                loading={loading}
              />
            )}
          </>
        )}
      >
        <Table
          className="std-table"
          bordered={bordered}
          rowKey={(r) => r.metadata?.uid || r.metadata?.name}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          columns={tableColumns}
          dataSource={filteredData}
          loading={loading}
          pagination={{
            size: 'small',
            showSizeChanger: true,
            showQuickJumper: false,
          }}
        />

        <HarvesterTemplateDetailDrawer
          open={detailVisible}
          onClose={() => setDetailVisible(false)}
          template={detailRecord}
          cloudId={cloudId}
        />
        
        <HarvesterOpsinfoDrawer
          open={opsInfoVisible}
          onClose={() => setOpsInfoVisible(false)}
          resourceType="Template"
          record={opsInfoRecord}
          activeTab={opsInfoActiveTab}
          onTabChange={setOpsInfoActiveTab}
          cloudId={cloudId}
        />
      </PageDetailSection>
  );
};

export default TemplatesSection;
