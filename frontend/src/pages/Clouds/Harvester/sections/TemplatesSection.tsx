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
import { Table, Input, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

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
}

const getTemplateNamespace = (tpl: any): string =>
  tpl?.metadata?.namespace || tpl?.namespace || '';

const getTemplateName = (tpl: any): string =>
  tpl?.metadata?.name || tpl?.name || '';

const getTemplateDescription = (tpl: any): string =>
  tpl?.spec?.description || tpl?.metadata?.annotations?.description || '';

const getTemplateDisplayName = (tpl: any): string =>
  tpl?.spec?.displayName ||
  tpl?.metadata?.annotations?.['tower.io/alias'] ||
  getTemplateName(tpl);
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
const TemplatesSection: React.FC<Props> = ({ cloudId, templates = [], loading, onRefresh }) => {
  /**
   * 搜索关键字（受控 Input）
   * - 用户在顶部输入框中输入的文本
   * - 用于在前端过滤模板列表（按名称 / 命名空间模糊匹配）
   */
  const [searchText, setSearchText] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');
  const navigate = useNavigate();
  const location = useLocation();

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

  const handleOpenDrawer = (tpl: any, tab: string = 'detail') => {
    if (!tpl) return;
    const r = { ...tpl, kind: tpl?.kind || 'VirtualMachineTemplate' };
    setDetailRecord(r);
    setDetailActiveTab(tab);
    setDetailVisible(true);
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
        <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
          {getTemplateDisplayName(r)}
        </span>
      )
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
      render: (_: any, r: any) => r.metadata?.creationTimestamp || '-'
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: any, r: any) => {
        const items: any[] = [
          {
            key: 'create_vm',
            label: '基于此模版创建虚拟机',
            onClick: () => handleCreateFromTemplate(r),
          },
          {
            key: 'edit_template',
            label: '修改模版',
            disabled: true,
          },
          {
            key: 'set_default',
            label: '设置默认版本',
            disabled: true,
          },
          {
            type: 'divider' as const,
          },
          {
            key: 'detail',
            label: '资源详情',
            onClick: () => handleOpenDrawer(r, 'detail'),
          },
        ];
        return (
          <ResourceActionsDropdown
            items={items}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    }
  ],
    [],
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
   * 过滤后的数据源（filteredData）
   *
   * 过滤逻辑：
   * - 当 searchText 为空时，直接返回原始 templates
   * - 当 searchText 不为空时：
   *   - 将关键字转为小写
   *   - 只保留名称或命名空间中包含关键字的模板
   */
  const filteredData = useMemo(() => {
    if (!searchText) return templates;
    const lower = searchText.toLowerCase();
    return templates.filter(item => 
      item?.metadata?.name?.toLowerCase().includes(lower) ||
      item?.metadata?.namespace?.toLowerCase().includes(lower)
    );
  }, [templates, searchText]);

  return (
      <PageDetailSection
        toolbarLeft={(
          <Input
            placeholder="搜索名称或命名空间"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="toolbar-search"
            allowClear
          />
        )}
        toolbarGapLeft={12}
        keywordWidth={200}
        toolbarRight={(
          <>
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
          bordered
          rowKey={(r) => r.metadata?.uid || r.metadata?.name}
          columns={tableColumns}
          dataSource={filteredData}
          loading={loading}
          pagination={{
            size: 'small',
            showQuickJumper: false,
          }}
        />

        <HarvesterResourceDrawer
          open={detailVisible}
          onClose={() => setDetailVisible(false)}
          resourceType="VirtualMachineTemplate"
          record={detailRecord}
          cloudId={cloudId}
          activeTab={detailActiveTab}
          onTabChange={setDetailActiveTab}
        />
      </PageDetailSection>
  );
};

export default TemplatesSection;
