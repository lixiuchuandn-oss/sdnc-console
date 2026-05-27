/**
 * ==============================================================================
 * 模块名称: Harvester 回收站视图组件 (RecycleBinSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/sections/RecycleBinSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件用于展示和管理 Harvester 云平台中已删除但尚未彻底清理的虚拟机。
 * 回收站机制允许用户在删除虚拟机后有一个"后悔期"，可以恢复误删的资源。
 * 
 * [核心功能]
 * 1. [回收站识别]: 
 *    - 通过 finalizers 中的 'tower.io/recycle-bin' 或 labels 中的标记识别回收站中的 VM
 *    - 只显示标记为回收站状态的虚拟机，过滤掉正常运行的 VM
 * 
 * 2. [倒计时显示]:
 *    - 显示每个虚拟机距离自动清理的剩余时间
 *    - 支持天/小时/分钟的倒计时显示
 *    - 过期虚拟机显示"已过期"标签
 * 
 * 3. [恢复功能]:
 *    - 支持将回收站中的虚拟机恢复到正常运行状态
 *    - 恢复后会移除回收站标记，VM 重新出现在主列表中
 * 
 * 4. [彻底删除]:
 *    - 支持彻底删除虚拟机（绕过回收站机制）
 *    - 可选择是否同步删除关联的数据卷（PVC）
 *    - 彻底删除后无法恢复
 * 
 * 5. [清理周期配置]:
 *    - 支持配置自动清理任务的执行间隔（1-168小时）
 *    - 配置保存在系统设置中，影响后端清理任务的执行频率
 * 
 * [数据展示]
 * - 与 VM 云主机视图保持一致的列定义和数据显示
 * - 额外显示"删除时间"和"剩余时间"两列
 * - 使用 SafeRead 辅助函数统一处理复杂的数据结构
 * 
 * [筛选功能]
 * - 支持按关键字（名称/ID/命名空间）筛选
 * - 支持按命名空间筛选（租户模式下隐藏）
 * - 支持按状态筛选
 * 
 * [列设置]
 * - 使用 useTableColumnSettings hook 管理列显示/隐藏
 * - 设置持久化到 localStorage
 * - 避免使用旧的 TableColumnSettings 组件（防止死锁问题）
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 上游数据:
 *    - 依赖父组件传入 `vms` (所有虚拟机列表), `volumes` (存储卷), `images` (镜像) 等
 *    - 本组件负责从 vms 中过滤出回收站中的 VM
 * 
 * 2. 关键服务:
 *    - harvesterApi.ts: restoreHarvesterVm, forceDeleteHarvesterVm
 *    - systemApi.ts: getSystemSetting, updateSystemSetting (清理周期配置)
 * 
 * 3. 状态管理:
 *    - 使用 React Hooks 管理本地 UI 状态
 *    - 筛选条件、抽屉状态、配置模态框状态等
 * 
 * ==============================================================================
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, message, Tooltip, App, Input, Select, Button, Checkbox, Drawer } from 'antd';
import { DeleteOutlined, SearchOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { restoreHarvesterVm, forceDeleteHarvesterVm } from 'services/harvester/vm';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import RecycleBinTaskConfigModal from '../../ecs/modals/RecycleBinTaskConfigModal';
import RecycleBinRecordsSection from './RecycleBinRecordsSection';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { selectRecycledVmRows, filterRecycledVmListRows } from '../lib/vmSectionUtils';
import { createVmRecycleBinListSafeRead } from '../lib/vmSafeRead';
import {
  buildRecycleBinTableColumns,
  HARVESTER_RECYCLE_BIN_TABLE_SETTINGS_KEY,
} from '../lib/recycleBinTableColumns';
import { buildRecycledVmNamespaceOptions } from '../lib/recycleBinSectionUtils';

/**
 * [类型定义] 组件 Props 接口
 * 
 * @property vms - [数据源] 所有虚拟机对象数组，包含正常和回收站中的 VM
 * @property loading - [UI状态] 表格是否处于加载中状态
 * @property cloudId - [上下文] 当前云平台的 ID，用于 API 调用
 * @property onRefresh - [回调] 请求父组件刷新数据列表
 * @property namespaces - [关联数据] 命名空间列表，用于解析租户/组织信息
 * @property volumes - [关联数据] 存储卷列表，用于显示卷详情
 * @property images - [关联数据] 镜像列表，用于显示镜像名称
 * @property isTenant - [权限控制] 是否为租户模式，影响功能可见性
 */
interface Props {
  vms: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: HarvesterSectionOnRefresh;
  namespaces?: any[];
  volumes?: any[];
  images?: any[];
  isTenant?: boolean;
}

const RecycleBinSection: React.FC<Props> = ({ 
  vms, 
  loading, 
  cloudId, 
  onRefresh,
  namespaces = [],
  volumes = [],
  images = [],
  isTenant = false,
}) => {
  // ==========================================
  // [状态管理] 1. 本地 UI 状态 (Local State)
  // ==========================================
  
  const { modal } = App.useApp(); // Ant Design App 上下文，用于显示确认对话框
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasRecycleBinWrite = useMemo(() => {
    return (
      hasPermissionForAction(perms, 'clouds.recycle-bin:write') ||
      hasPermissionForAction(perms, 'clouds.ecs:write') ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [perms]);

  // [筛选状态] 用户输入的筛选条件
  const [keyword, setKeyword] = useState<string>(''); // 关键字搜索（名称/ID/命名空间）
  const [namespaceFilter, setNamespaceFilter] = useState<string>(''); // 命名空间筛选
  const [statusFilter, setStatusFilter] = useState<string>(''); // 状态筛选（回收站仅允许按「已停止」筛，与展示一致）

  // 历史上曾按真实 printableStatus 枚举；现统一为已停止，避免残留 running 等条件导致列表为空
  useEffect(() => {
    if (statusFilter && statusFilter !== 'stopped') setStatusFilter('');
  }, [statusFilter]);

  // [YAML 抽屉] 查看虚拟机 CRD
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);
  // [配置模态框状态] 控制任务配置模态框的显示
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [recordsDrawerVisible, setRecordsDrawerVisible] = useState(false);

  // ==========================================
  // [数据处理] 2. 数据过滤与转换 (Data Processing)
  // ==========================================
  
  /**
   * 过滤出回收站中的虚拟机
   * 
   * 回收站识别规则:
   * 1. 检查 metadata.finalizers 数组中是否包含 'tower.io/recycle-bin'
   * 2. 检查 metadata.labels 中 'tower.io/recycle-bin' 是否为 'true'
   * 
   * 满足任一条件即视为回收站中的 VM
   * 
   * @returns 回收站中的虚拟机数组
   */
  const recycledVms = useMemo(() => selectRecycledVmRows(vms), [vms]);

  // ==========================================
  // [工具函数] 3. 辅助函数 (Utility Functions)
  // ==========================================

  /** 列表字段读取：基于 createVmListSafeRead，回收站 status 固定 Stopped */
  const SafeRead = useMemo(
    () => createVmRecycleBinListSafeRead(namespaces || [], volumes || [], images || []),
    [namespaces, volumes, images],
  );

  // ==========================================
  // [筛选选项] 4. 动态筛选选项生成 (Filter Options)
  // ==========================================
  
  /**
   * 生成命名空间筛选选项
   * 
   * 从回收站中的 VM 提取所有唯一的命名空间，生成下拉选项
   * 用于工具栏的命名空间筛选器
   */
  const namespaceOptions = useMemo(
    () => buildRecycledVmNamespaceOptions(recycledVms),
    [recycledVms],
  );

  /**
   * 状态筛选选项：回收站在界面上统一为「已停止」，不再罗列删除前的运行中等状态。
   */
  const statusOptions = useMemo(() => [{ value: 'stopped', label: '已停止' }], []);

  /**
   * 应用所有筛选条件后的虚拟机列表
   * 
   * 筛选逻辑（AND 关系）:
   * 1. 关键字筛选: 在名称、ID、命名空间中搜索
   * 2. 命名空间筛选: 精确匹配
   * 3. 状态筛选: 精确匹配（不区分大小写）
   * 
   * 所有筛选条件都是可选的，未设置时不进行筛选
   */
  const filteredVms = useMemo(
    () =>
      filterRecycledVmListRows(recycledVms, {
        keyword,
        namespaceFilter,
        statusFilter,
        safeRead: SafeRead,
      }),
    [recycledVms, keyword, namespaceFilter, statusFilter, SafeRead],
  );

  /**
   * 恢复虚拟机
   * 
   * 将回收站中的虚拟机恢复到正常运行状态:
   * 1. 调用 restoreHarvesterVm API
   * 2. 后端会移除回收站标记（finalizer 或 label）
   * 3. VM 重新出现在主列表中
   * 4. 刷新列表以反映变化
   * 
   * @param r - 要恢复的虚拟机对象
   */
  const handleRestore = useCallback(async (r: any) => {
    if (!hasRecycleBinWrite) {
      message.error('当前账号没有回收站操作权限（需要 clouds.recycle-bin:write 或 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    const ns = r?.metadata?.namespace || r?.namespace || '';
    const name = r?.metadata?.name || r?.InstanceId?.split('/')[1] || '';
    const instanceId = `${ns}/${name}`;
    
    try {
      await restoreHarvesterVm(cloudId, instanceId);
      message.success('恢复成功');
      await runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(`恢复失败: ${e.message}`);
    }
  }, [cloudId, hasRecycleBinWrite, onRefresh]);

  const handleOpenYaml = useCallback(
    (record: any) => {
      openYamlDrawer({ ...record, kind: 'VirtualMachine' }, { title: '云主机 YAML' });
    },
    [openYamlDrawer],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  /**
   * 彻底删除虚拟机
   * 
   * 这是回收站中的危险操作，会永久删除虚拟机，无法恢复
   * 
   * 功能特点:
   * 1. 显示详细的确认对话框，包含警告信息
   * 2. 列出关联的数据卷（PVC），让用户了解影响范围
   * 3. 提供选项：是否同步删除关联的数据卷
   *    - 默认不勾选（保护数据）
   *    - 用户可勾选以彻底清理所有相关资源
   * 
   * 删除流程:
   * 1. 显示确认对话框
   * 2. 用户确认后调用 forceDeleteHarvesterVm API
   * 3. 根据 shouldDeleteVolumes 参数决定是否删除关联卷
   * 4. 删除成功后刷新列表
   * 
   * @param r - 要删除的虚拟机对象
   * 
   * 注意: 使用闭包变量 shouldDeleteVolumes 来捕获用户的选择
   * 因为 Checkbox 的 onChange 在对话框渲染时执行，而 onOk 在用户确认时执行
   */
  const handleForceDelete = useCallback(async (r: any) => {
    if (!hasRecycleBinWrite) {
      message.error('当前账号没有回收站操作权限（需要 clouds.recycle-bin:write 或 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    const ns = r?.metadata?.namespace || r?.namespace || '';
    const name = r?.metadata?.name || r?.InstanceId?.split('/')[1] || '';
    const instanceId = `${ns}/${name}`;

    // 获取关联卷信息
    const volDetails = SafeRead.volumeDetails(r);
    const volumeNames = volDetails.filter((v: any) => v.claimName).map((v: any) => v.claimName).join(', ');
    
    // 默认勾选删除卷，通过闭包变量控制
    // 注意: 这个变量在 Checkbox 的 onChange 中被修改，在 onOk 中被使用
    // 使用闭包而不是 state，因为需要在对话框的 onOk 回调中访问
    let shouldDeleteVolumes = !!volumeNames;
    
    modal.confirm({
      title: '确认彻底删除',
      icon: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
      width: 500,
      content: (
        <div style={{ marginTop: 16 }}>
          <p>确定要彻底删除虚拟机 <b>{name}</b> 吗？</p>
          <div style={{ marginBottom: 16, color: '#ff4d4f', background: '#fff1f0', padding: '8px 12px', border: '1px solid #ffccc7', borderRadius: 4 }}>
            <WarningOutlined style={{ marginRight: 8 }} />
            警告：此操作不可恢复。虚拟机将被永久删除。
          </div>
          {volumeNames && (
              <div style={{ marginBottom: 16, background: '#f5f5f5', padding: '8px 12px',border: '1px solid #d9d9d9', borderRadius: 4 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>关联的数据卷 (PVC):</div>
                <div style={{ color: 'rgba(0,0,0,0.65)' }}>{volumeNames}</div>
                <div style={{ marginTop: 8, borderTop: '1px solid #e8e8e8', paddingTop: 8 }}>
                   <Checkbox defaultChecked={true} onChange={(e) => { shouldDeleteVolumes = e.target.checked; }}>
                     同步删除关联卷 (PVC)
                   </Checkbox>
                   <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>
                     注意：勾选后将永久删除关联的数据卷 (PVC)，数据无法找回。
                   </div>
                </div>
              </div>
          )}
        </div>
      ),
      okText: '彻底删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await forceDeleteHarvesterVm(cloudId, instanceId, shouldDeleteVolumes);
          message.success('虚拟机已彻底删除');
          await runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: any) {
          message.error(`彻底删除失败: ${e.message}`);
        }
      },
    });
  }, [cloudId, hasRecycleBinWrite, onRefresh, modal, SafeRead]);

  // ==========================================
  // [表格定义] 7. 表格列配置 (Table Columns)
  // ==========================================
  
  const allColumns = useMemo(
    () =>
      buildRecycleBinTableColumns({
        safeRead: SafeRead,
        isTenant,
        hasRecycleBinWrite,
        onRestore: handleRestore,
        onForceDelete: handleForceDelete,
        onOpenYaml: handleOpenYaml,
      }),
    [SafeRead, handleRestore, handleForceDelete, handleOpenYaml, hasRecycleBinWrite, isTenant],
  );

  const { displayColumns } = useTableColumnSettings(
    allColumns,
    HARVESTER_RECYCLE_BIN_TABLE_SETTINGS_KEY,
  );

  // ==========================================
  // [UI渲染] 8. 组件结构返回 (Render)
  // ==========================================
  
  return (
    <PageDetailSection 
      asCard={false}
      toolbarLeft={
        /**
         * 工具栏左侧: 筛选器
         * 
         * 包含:
         * 1. 关键字搜索框 - 搜索名称/ID/命名空间
         * 2. 命名空间下拉 - 租户模式下隐藏
         * 3. 状态下拉 - 筛选不同状态的 VM
         * 4. 重置按钮 - 当有筛选条件时显示，一键清空所有筛选
         */
        <>
          <Input
            allowClear
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {!isTenant && namespaceOptions.length > 0 && (
            <Select
              allowClear
              showSearch
              placeholder="项目"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              className="toolbar-filter-sm"
              options={namespaceOptions}
            />
          )}
          {statusOptions.length > 0 && (
            <Select
              allowClear
              placeholder="状态"
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter(v || '')}
              className="toolbar-filter-sm"
              options={statusOptions}
            />
          )}
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNamespaceFilter('');
              setStatusFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        /**
         * 工具栏右侧: 操作按钮
         * 
         * 包含:
         * 1. 设定清理间隔 - 管理员/运维可见；租户端不展示
         * 2. 列设置按钮 - 使用 TableColumnSettingsButton 组件，管理列的显示/隐藏
         * 3. 刷新按钮 - 手动刷新数据列表
         */
        <div className="toolbar-actions">
          {!isTenant && (
            <Tooltip title={undefined}>
              <span>
                <Button
                  type="primary"
                  disabled={!hasRecycleBinWrite}
                  onClick={() => {
                    if (!hasRecycleBinWrite) {
                      message.error(
                        '当前账号没有回收站操作权限（需要 clouds.recycle-bin:write 或 clouds.ecs:write 或 clouds:write 权限）',
                      );
                      return;
                    }
                    setConfigModalVisible(true);
                  }}
                >
                  任务配置
                </Button>
              </span>
            </Tooltip>
          )}
          <Button onClick={() => setRecordsDrawerVisible(true)}>
            回收站记录
          </Button>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_recycle_bin_table"
          />
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </div>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredVms}
        columns={displayColumns}
        loading={loading}
        rowKey={(r: any) => SafeRead.uid(r)}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{
          emptyText: '回收站为空',
        }}
      />
      
      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || '云主机 YAML'}
      />
      {!isTenant && (
        <RecycleBinTaskConfigModal
          open={configModalVisible}
          onClose={() => setConfigModalVisible(false)}
          onSuccess={() => {
            console.log('回收站任务配置已更新');
          }}
        />
      )}
      <Drawer
        title="回收站记录"
        width={1200}
        open={recordsDrawerVisible}
        onClose={() => setRecordsDrawerVisible(false)}
        destroyOnHidden
      >
        <RecycleBinRecordsSection cloudId={cloudId} />
      </Drawer>
    </PageDetailSection>
  );
};

export default RecycleBinSection;
