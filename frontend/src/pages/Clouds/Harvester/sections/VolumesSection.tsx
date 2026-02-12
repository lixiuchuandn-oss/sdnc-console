import React, { useMemo, useState, useEffect } from 'react';
import { Table, Tag, Input, Select, Button, Dropdown, Modal, Form, message, InputNumber, Checkbox, Tabs, Descriptions } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { attachHarvesterVolumeToVmByName, detachHarvesterVolumeFromVm, deleteHarvesterVolume, createHarvesterVolume, exportHarvesterImageFromVolume, createHarvesterVolumeSnapshot, updateHarvesterVolume, cloneHarvesterVolume, listHarvesterSnapshotClasses } from '../../../../services/harvesterApi';
import TableColumnSettings from '../../../../components/TableColumnSettings';

import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

import { isSystemNamespace, isSystemStorageClass } from '../../../../utils/harvesterUtils';

type Props = {
  cloudId: string;
  volumes: any[];
  loading: boolean;
  vms?: any[];
  storageClasses?: any[];
  namespacesOptions?: string[];
  onRefresh?: (force?: boolean) => void;
};

// ----------------------------------------------------------------------
  // 1. Clean Data Model (ViewModel) based on PCV Spec
  // ----------------------------------------------------------------------
  interface VolumeView {
    key: string;
    name: string;              // metadata.name (PVC Name)
    alias?: string;            // metadata.annotations['tower.io/alias']
    namespace: string;         // metadata.namespace
    pvName: string;            // spec.volumeName (PV Name)
    phase: string;             // status.phase
    capacityRaw: string;       // status.capacity.storage | spec.resources.requests.storage
    capacityBytes: number;     // parsed value
    storageClass: string;      // spec.storageClassName
    accessModes: string[];     // spec.accessModes
    volumeMode: string;        // spec.volumeMode
    creationTimestamp: string; // metadata.creationTimestamp
    attachedTo: string[];      // status.attachedTo (legacy/extra) or calculated
    links?: { view?: string };
    raw: any;                  // Original Record
  }

// ----------------------------------------------------------------------
// 2. Helpers
// ----------------------------------------------------------------------
const parseQuantity = (s: string | number | undefined): number => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    'Ki': 1024, 'Mi': 1024**2, 'Gi': 1024**3, 'Ti': 1024**4, 'Pi': 1024**5,
    'k': 1000, 'M': 1000**2, 'G': 1000**3, 'T': 1000**4, 'P': 1000**5
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
};

const gbText = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
};

const cnStatus = (s: string): string => {
  const k = s.toLowerCase();
  const m: Record<string, string> = {
    healthy: '健康', degraded: '降级', faulted: '故障', unknown: '未知',
    bound: '已绑定', pending: '等待中', lost: '丢失', detached: '已卸载',
    attaching: '使用中', attached: '使用中', detaching: '卸载中',
    maintenance: '维护', restoring: '恢复中', creating: '创建中',
    deleting: '删除中', error: '错误'
  };
  return m[k] || s;
};

const statusBadge = (s: string) => {
  const k = s.toLowerCase();
  const text = cnStatus(s);
  let color: string | undefined = undefined;
  
  if (['healthy', 'bound'].includes(k)) color = 'green';
  else if (['degraded', 'pending'].includes(k)) color = 'orange';
  else if (['faulted', 'error', 'lost'].includes(k)) color = 'red';
  else if (['maintenance'].includes(k)) color = 'gold';
  else if (['attached', 'attaching', 'detaching', 'restoring', 'creating', 'deleting'].includes(k)) color = 'blue';

  return <Tag color={color}>{text}</Tag>;
};

// ----------------------------------------------------------------------
// 3. Component
// ----------------------------------------------------------------------
const VolumesSection: React.FC<Props> = ({ cloudId, volumes, loading, vms, storageClasses: propStorageClasses, namespacesOptions, onRefresh }) => {
  // Filters
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [scFilter, setScFilter] = useState<string>('');
  const [showSystemVolumes, setShowSystemVolumes] = useState<boolean>(false);
  
  // Selection
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  
  // Detail Drawer State
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  // Forms
  const [createForm] = Form.useForm();
  const [attachForm] = Form.useForm();
  const [exportForm] = Form.useForm();
  const [snapshotForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [cloneForm] = Form.useForm();

  // Active Record
  const [currentRecord, setCurrentRecord] = useState<VolumeView | null>(null);
  const [creating, setCreating] = useState(false);
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  const [snapshotClasses, setSnapshotClasses] = useState<any[]>([]);

  // Sync Storage Classes
  useEffect(() => {
    if (propStorageClasses) setStorageClasses(propStorageClasses);
  }, [propStorageClasses]);

  // Set default SC in Create Form
  useEffect(() => {
    try {
      const cur = createForm.getFieldValue('storageClassName');
      if (!cur && storageClasses.length > 0) {
        const names = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
        const prefer = names.find(n => n.toLowerCase().includes('longhorn')) || names[0];
        if (prefer) createForm.setFieldsValue({ storageClassName: prefer });
      }
    } catch {}
  }, [storageClasses, createForm]);

  // ----------------------------------------------------------------
  // SafeRead Helper (Robust Data Access)
  // ----------------------------------------------------------------
  const SafeRead = {
    // Real ID / Name (for logic)
    id: (r: any) => r?.name || r?.metadata?.name || '',
    // Display Name (for UI)
    name: (r: any) => r?.alias || r?.metadata?.annotations?.['tower.io/alias'] || r?.name || r?.metadata?.name || '',
    namespace: (r: any) => r?.namespace || r?.metadata?.namespace || '',
    phase: (r: any) => r?.phase || r?.status?.phase || r?.status?.state || 'Unknown',
    capacity: (r: any) => r?.capacityRaw || r?.status?.capacity?.storage || r?.spec?.resources?.requests?.storage || '',
    storageClass: (r: any) => r?.storageClass || r?.spec?.storageClassName || '',
    accessModes: (r: any) => {
      const modes = r?.accessModes || r?.spec?.accessModes || r?.status?.accessModes;
      return Array.isArray(modes) ? modes : (modes ? [modes] : []);
    },
    attachedTo: (r: any) => {
      if (Array.isArray(r?.attachedTo)) return r.attachedTo;
      // Harvester/K8s usually doesn't have attachedTo in status, but if backend provides it:
      return [];
    },
    // Find the VM this volume is attached to
    attachedVm: (r: any) => {
      const list = Array.isArray(vms) ? vms : [];
      const pvcName = SafeRead.id(r); // PVC Name (metadata.name)
      const pvcNs = SafeRead.namespace(r);

      // Strictly use PVC Name to match VM's volumeClaims
      // This is the most reliable way as Harvester/K8s maps PVCs to VMs via spec.volumes.persistentVolumeClaim.claimName
      return list.find((vm: any) => {
        // Check Namespace (Support both flat object and K8s object)
        const vmNs = vm.namespace || vm.metadata?.namespace || vm.extra?.namespace || vm.Extra?.Namespace || '';
        if (String(vmNs) !== pvcNs) return false;

        // Check Claims
        // Strategy 1: Check pre-parsed volumeClaims (from backend)
        const claims = vm.volumeClaims || vm.extra?.volumeClaims || vm.Extra?.VolumeClaims;
        if (Array.isArray(claims) && claims.includes(pvcName)) return true;

        // Strategy 2: Deep inspect spec.template.spec.volumes (Standard K8s/Harvester structure)
        const volumes = vm?.spec?.template?.spec?.volumes;
        if (Array.isArray(volumes)) {
            const found = volumes.some((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
            if (found) return true;
        }

        return false;
      });
    }
  };

  // ----------------------------------------------------------------
  // Core Data Normalization (The "Rewrite" Logic)
  // ----------------------------------------------------------------
  const dataSource = useMemo<VolumeView[]>(() => {
    const rawList = Array.isArray(volumes) ? volumes : [];
    
    return rawList.map((r: any) => {
      // Prioritize rawData (K8s Spec) if available (e.g. from backend wrapper)
      const source = r?.rawData || r || {};
      
      // 1. Extract Basic Meta (Prioritize PCV Spec > Flat/Legacy)
      const name = source?.metadata?.name || r?.name || '';
      const namespace = source?.metadata?.namespace || r?.namespace || '';
      const alias = source?.metadata?.annotations?.['tower.io/alias'] || '';
      
      // 2. Extract Spec Details
      const pvName = source?.spec?.volumeName || r?.volumeName || r?.pvcName || ''; 
      const storageClass = source?.spec?.storageClassName || r?.storageClassName || '';
      const accessModes = source?.spec?.accessModes || source?.status?.accessModes || r?.accessModes || [];
      const volumeMode = source?.spec?.volumeMode || r?.volumeMode || 'Block';

      // 3. Extract Status & Capacity
      // PCV Spec: status.phase, status.capacity.storage
      const phase = source?.status?.phase || r?.phase || source?.status?.state || r?.state || 'Unknown';
      const capacityRaw = source?.status?.capacity?.storage || source?.spec?.resources?.requests?.storage || r?.size || r?.capacity || '';
      
      // 4. Attached Info (Legacy might have attachedTo array, otherwise computed)
      const attachedTo = Array.isArray(r?.attachedTo) ? r.attachedTo : [];

      return {
        key: source?.metadata?.uid || r?.id || `${namespace}/${name}`,
        name,
        alias,
        namespace,
        pvName,
        phase,
        capacityRaw: String(capacityRaw),
        capacityBytes: parseQuantity(capacityRaw),
        storageClass,
        accessModes: Array.isArray(accessModes) ? accessModes : [String(accessModes)],
        volumeMode,
        creationTimestamp: source?.metadata?.creationTimestamp || r?.created,
        attachedTo,
        links: r?.links,
        raw: r // Keep original record
      };
    }).filter(v => !!v.name); // Filter out empty records
  }, [volumes]);

  // ----------------------------------------------------------------
  // Helper: Find VM for a Volume
  // ----------------------------------------------------------------
  // Replaced by SafeRead.attachedVm


  // ----------------------------------------------------------------
  // Filtering
  // ----------------------------------------------------------------
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return dataSource.filter(item => {
      // Keyword
      if (kw && !item.name.toLowerCase().includes(kw)) return false;
      // Status
      if (st && item.phase.toLowerCase() !== st) return false;
      
      // Namespace System Filter
      if (!showSystemVolumes && isSystemNamespace(item.namespace)) return false;

      // Namespace Filter
      if (nsFilter && item.namespace !== nsFilter) return false;
      // StorageClass
      if (scFilter && item.storageClass !== scFilter) return false;

      return true;
    });
  }, [dataSource, keyword, statusFilter, nsFilter, scFilter, showSystemVolumes]);

  // Options for Filters
  const nsOptions = useMemo(() => {
    const set = new Set<string>();

    // Priority 1: Use provided namespacesOptions (from CloudConsole)
    if (Array.isArray(namespacesOptions)) {
      namespacesOptions.forEach(ns => ns && set.add(ns));
    }

    // Priority 2: Fallback to data from volumes and VMs
    if (set.size === 0) {
      dataSource.forEach(v => v.namespace && set.add(v.namespace));
      (vms || []).forEach((vm: any) => {
        const ns = vm?.extra?.namespace || vm?.namespace || vm?.Extra?.Namespace;
        if (ns) set.add(ns);
      });
      if (!set.has('default')) set.add('default');
    }
    
    // Filter system namespaces unless "showSystemVolumes" is true
    let list = Array.from(set);
    if (!showSystemVolumes) {
      list = list.filter(ns => !isSystemNamespace(ns));
    }
    
    return list.sort().map(s => ({ value: s, label: s }));
  }, [dataSource, vms, showSystemVolumes, namespacesOptions]);

  const statusOptions = [
    'healthy','degraded','faulted','detached','attaching','attached','detaching','maintenance','restoring','creating','deleting','error','bound','pending','lost'
  ];

  // ----------------------------------------------------------------
  // Actions Handlers
  // ----------------------------------------------------------------
  const handleOpenDrawer = async (record: VolumeView, tab: string = 'detail') => {
    // Inject kind: 'PersistentVolumeClaim' for events fetching
    const raw = record.raw || {};
    // Ensure raw data has kind
    if (!raw.kind) raw.kind = 'PersistentVolumeClaim';
    // Ensure raw data has metadata
    if (!raw.metadata) {
      raw.metadata = {
        name: record.name,
        namespace: record.namespace,
        uid: record.key,
        creationTimestamp: record.creationTimestamp
      };
    }

    setDetailRecord(raw);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter(v => selectedRowKeys.includes(v.key));
    
    Modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${targets.length} 个卷：${targets.map(t => t.name).join(', ')}`,
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const results = await Promise.allSettled(targets.map(t => deleteHarvesterVolume(cloudId, t.namespace, t.name)));
          const ok = results.filter(x => x.status === 'fulfilled').length;
          const fail = results.length - ok;
          if (ok > 0) message.success(`成功删除 ${ok} 个卷`);
          if (fail > 0) message.error(`${fail} 个卷删除失败`);
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      }
    });
  };

  const handleAttach = (r: VolumeView) => {
    // Proactively refresh if vms are missing (common issue on fresh load)
    if (!vms || vms.length === 0) {
      onRefresh?.(true);
    }

    const vm = SafeRead.attachedVm(r);
    setCurrentRecord(r);
    attachForm.resetFields();
    attachForm.setFieldsValue({ 
      instanceId: vm ? vm.InstanceId : undefined, 
      diskName: r.name, 
      bus: 'virtio' 
    });
    setAttachOpen(true);
  };

  const handleDetach = async (r: VolumeView) => {
    // Proactively refresh if vms are missing
    if (!vms || vms.length === 0) {
      onRefresh?.();
      message.loading('正在同步云主机数据，请稍后重试...', 1);
      return;
    }

    const vm = SafeRead.attachedVm(r);
    if (!vm) {
      message.warning('无法找到关联的云主机，请确认数据已同步');
      return;
    }
    
    // Attempt to find the disk name used in the VM (might not be PVC name)
    const diskName = vm?.Extra?.VolumeMap?.[r.name] || ''; 
    
    if (!diskName) {
      message.warning('无法确定挂载的磁盘名称');
      return;
    }

    const iid = String(vm.InstanceId || '');
    const iidNameOnly = iid.includes('/') ? iid.split('/').pop() : iid;

    Modal.confirm({
      title: '确认卸载',
      content: `将从云主机 ${vm.InstanceName || vm.InstanceId} 卸载卷 ${r.name}`,
      onOk: async () => {
        try {
          // Try with full ID first, then short name fallback
          try {
            await detachHarvesterVolumeFromVm(cloudId, iid, { name: String(diskName) });
          } catch (e: any) {
            if (String(e?.message).includes('NotFound')) {
              await detachHarvesterVolumeFromVm(cloudId, iidNameOnly!, { name: String(diskName) });
            } else {
              throw e;
            }
          }
          message.success('卸载成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '卸载失败');
        }
      }
    });
  };

  // ----------------------------------------------------------------
  // Columns
  // ----------------------------------------------------------------
  const allColumns = useMemo(() => [
    { 
      title: 'PVC名称', 
      dataIndex: 'name',
      key: 'name', 
      render: (_: string, r: VolumeView) => (
        <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
          {r.alias || r.name}
        </span> 
      )
    },
    { 
      title: 'PVC ID', 
      dataIndex: 'name',
      key: 'id', 
      render: (v: string) => <span className="text-secondary">{v}</span> 
    },
    { 
      title: '卷名称 (PV)', 
      dataIndex: 'pvName',
      key: 'pvName', 
      render: (v: string) => <span className="text-secondary">{v || '-'}</span> 
    },
    { 
      title: '状态', 
      dataIndex: 'phase',
      key: 'phase', 
      render: (v: string) => statusBadge(v) 
    },
    { 
      title: '命名空间', 
      dataIndex: 'namespace',
      key: 'namespace' 
    },
    { 
      title: '存储类', 
      dataIndex: 'storageClass',
      key: 'storageClass',
      render: (v: string) => <span className="text-secondary">{v || '-'}</span>
    },
    { 
      title: '访问模式', 
      dataIndex: 'accessModes',
      key: 'accessModes',
      render: (modes: string[]) => modes.length ? modes.map(m => <Tag key={m}>{m}</Tag>) : '-'
    },
    { 
      title: '卷类型', 
      dataIndex: 'volumeMode',
      key: 'volumeMode',
      render: (v: string) => <span className="text-secondary">{v || '-'}</span>
    },
    { 
      title: '挂载云主机', 
      key: 'attachedTo', 
      render: (_: any, r: VolumeView) => {
        const vm = SafeRead.attachedVm(r);
        if (vm) {
            // 优先显示别名，其次是 InstanceName 或 name
            const alias = vm.metadata?.annotations?.['tower.io/alias'];
            const name = alias || vm.name || vm.metadata?.name || vm.InstanceName || vm.InstanceId;
            return name;
        }
        return r.attachedTo.length > 0 ? r.attachedTo.join(', ') : '-';
      } 
    },
    { 
      title: '大小', 
      dataIndex: 'capacityBytes',
      key: 'size', 
      render: (bytes: number) => gbText(bytes) 
    },
    { 
      title: '操作', 
      key: 'actions', 
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: VolumeView) => {
        const vm = SafeRead.attachedVm(r);
        
        const items: any[] = [
          { key: 'detail', label: '资源详情', onClick: () => handleOpenDrawer(r, 'detail') },
          { type: 'divider' as const },
          { 
            key: 'edit', 
            label: '编辑配置', 
            onClick: () => { 
              setCurrentRecord(r); 
              editForm.resetFields(); 
              editForm.setFieldsValue({ 
                sizeGi: r.capacityBytes / (1024**3)
              }); 
              setEditOpen(true); 
            } 
          },
          { 
            key: 'attach', 
            label: '挂载到虚拟机', 
            disabled: !!vm, 
            onClick: () => handleAttach(r) 
          },
          ...(vm ? [{ 
            key: 'detach', 
            label: '从云主机卸载', 
            danger: true, 
            onClick: () => handleDetach(r) 
          }] : []),
          // Metadata/SourceData actions removed as per request

          { 
            key: 'export', 
            label: '导出为镜像', 
            onClick: () => { 
              setCurrentRecord(r); 
              exportForm.resetFields(); 
              const scNames = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
              const defaultSc = scNames.find(n => n.toLowerCase() === 'longhorn') || scNames.find(n => n.toLowerCase().includes('longhorn')) || scNames[0];
              exportForm.setFieldsValue({ displayName: r.name, targetStorageClassName: defaultSc }); 
              setExportOpen(true); 
            } 
          },
          { 
            key: 'snapshot', 
            label: '创建快照', 
            onClick: () => { 
              setCurrentRecord(r); 
              snapshotForm.resetFields(); 
              // 生成带随机后缀的快照名称以避免冲突
              const suffix = Math.random().toString(36).substring(2, 7);
              snapshotForm.setFieldsValue({ name: `${r.name}-snap-${suffix}` }); 
              setSnapshotOpen(true); 
            } 
          },

          { 
            key: 'clone', 
            label: '克隆虚拟卷', 
            onClick: () => { 
              setCurrentRecord(r); 
              cloneForm.resetFields(); 
              cloneForm.setFieldsValue({ 
                targetNamespace: r.namespace, 
                newName: `${r.name}-clone`, 
                sizeGi: r.capacityBytes / (1024**3), 
                storageClassName: r.storageClass,
                fromSnapshotName: r.name, // Usually snapshot name, but API might accept PVC name for direct clone if supported, or this is placeholder
                accessModes: ['ReadWriteOnce'],
                volumeMode: 'Block'
              }); 
              setCloneOpen(true); 
            } 
          },
          { type: 'divider' as const },
          { 
            key: 'delete', 
            label: '删除', 
            danger: true, 
            onClick: () => {
              Modal.confirm({ 
                title: `确认删除卷 ${r.name}？`, 
                content: '删除后无法恢复。', 
                okText: '确认', cancelText: '取消', okButtonProps: { danger: true },
                onOk: async () => { 
                  try { 
                    await deleteHarvesterVolume(cloudId, r.namespace, r.name); 
                    message.success('删除成功'); 
                    onRefresh?.(); 
                  } catch (e: any) { 
                    message.error(e.message || '删除失败'); 
                  } 
                } 
              });
            } 
          }
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    },
  ], [cloudId, vms, storageClasses, onRefresh, handleOpenDrawer]);

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="toolbar-search" />
          <Select
            allowClear showSearch placeholder="命名空间"
            value={nsFilter || undefined} onChange={(v) => setNsFilter(v || '')}
            className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, ...nsOptions]}
          />
          <Select
            allowClear placeholder="状态"
            value={statusFilter || undefined} onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, ...statusOptions.map(k => ({ value: k, label: cnStatus(k) }))]}
          />
          <Select
            allowClear showSearch placeholder="存储类"
            value={scFilter || undefined} onChange={(v) => setScFilter(v || '')}
            className="toolbar-filter" 
            options={[{ value: '', label: '全部' }, ...dataSource.map(v => v.storageClass).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map(s => ({ value: s, label: s }))]}
          />
          <Checkbox 
            checked={showSystemVolumes} 
            onChange={(e: any) => setShowSystemVolumes(e.target.checked)}
          >
            显示系统卷
          </Checkbox>
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => { 
            createForm.resetFields(); 
            const scNames = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
            const defaultSc = scNames.find(n => n.toLowerCase().includes('longhorn')) || scNames[0];
            const defaultNs = nsOptions.length > 0 ? nsOptions[0].value : undefined;
            
            createForm.setFieldsValue({ 
              alias: '测试pvc',
              namespace: defaultNs,
              sizeGi: 40,
              accessModes: 'ReadWriteMany',
              volumeMode: 'Block',
              storageClassName: defaultSc
            }); 
            setCreateOpen(true); 
          }}>创建卷</Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{ key: 'batchDelete', label: '批量删除', disabled: selectedRowKeys.length === 0, danger: true }],
              onClick: ({ key }) => key === 'batchDelete' && handleBatchDelete()
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_volumes_table"
            defaultHiddenColumns={['namespace', 'volumeMode']}
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey="key"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{size:'small'}}
      />

      {/* --- Modals --- */}
      
      {/* 1. Metadata - Removed */}

      {/* 2. Create */}
      <StdFormModal
        title="创建卷" open={createOpen} onCancel={() => setCreateOpen(false)} confirmLoading={creating}
        okText="创建"
        form={createForm}
        onFinish={async (v: any) => {
          try {
            setCreating(true);
            const modes = Array.isArray(v.accessModes) ? v.accessModes : (v.accessModes ? [v.accessModes] : ['ReadWriteMany']);
            
            // Generate ID: id-vol-{11 random chars}
            let suffix = Math.random().toString(36).substring(2);
            while (suffix.length < 11) suffix += Math.random().toString(36).substring(2);
            suffix = suffix.substring(0, 11);
            const customId = `id-vol-${suffix}`;

            const payload = {
              namespace: String(v.namespace || ''),
              name: customId,
              sizeGi: Number(v.sizeGi || 0),
              accessModes: modes,
              volumeMode: String(v.volumeMode || 'Block'),
              storageClassName: String(v.storageClassName || '') || undefined,
              annotations: {
                'tower.io/alias': v.alias || ''
              }
            };
            await createHarvesterVolume(cloudId, payload);
            message.success('创建成功');
            setCreateOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '创建失败'); }
          finally { setCreating(false); }
        }}
      >
          <Form.Item label="别名" name="alias" rules={[{ required: true }]}><Input placeholder="例如: 测试pvc" /></Form.Item>
          <Form.Item label="命名空间" name="namespace" rules={[{ required: true }]}>
            <Select showSearch options={nsOptions} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="访问模式" name="accessModes" initialValue="ReadWriteMany">
            <Select options={[{ value: 'ReadWriteOnce', label: 'RWO' }, { value: 'ReadWriteMany', label: 'RWX' }, { value: 'ReadOnlyMany', label: 'ROX' }]} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="卷类型" name="volumeMode" initialValue="Block">
            <Select options={[{ value: 'Block', label: 'Block' }, { value: 'Filesystem', label: 'Filesystem' }]} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="存储类" name="storageClassName">
            <Select allowClear options={storageClasses.map(s => {
              const n = s?.metadata?.name || s?.name;
              return { value: n, label: n };
            }).filter(x => x.value && !isSystemStorageClass(x.value))} style={{ width: '100%' }} />
          </Form.Item>
      </StdFormModal>

      {/* 3. Attach */}
      <StdFormModal
        title="挂载到云主机" open={attachOpen} onCancel={() => setAttachOpen(false)}
        okText="挂载"
        form={attachForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            const vm = (vms || []).find((x: any) => (x.id || x.InstanceId) === v.instanceId);
            if (!vm) { message.error('未找到云主机'); return; }
            
            const vmName = vm.name || vm.InstanceName || '';
            // If ID is complex path, try to parse name (fallback)
            const iid = String(vm.id || vm.InstanceId || '');
            const finalName = vmName || (iid.includes('/') ? iid.split('/').pop() : iid);

            if (!finalName) { message.error('云主机名称无效'); return; }

            // Generate a safe disk name
            const computedDiskName = (currentRecord.name).replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 63);

            await attachHarvesterVolumeToVmByName(cloudId, currentRecord.namespace, finalName, {
              diskName: computedDiskName,
              bus: v.bus || 'virtio',
              pvcNamespace: currentRecord.namespace,
              pvcName: currentRecord.name
            });
            message.success('挂载成功');
            setAttachOpen(false);
            onRefresh?.(true);
          } catch (e: any) { message.error(e.message || '挂载失败'); }
        }}
      >
          <Form.Item label="云主机" name="instanceId" rules={[{ required: true }]}>
            <Select showSearch placeholder="选择云主机" options={(vms || [])
              .filter((vm: any) => {
                const extra = vm?.extra || vm?.Extra || {};
                const vmNs = extra.namespace || vm.namespace || extra.Namespace;
                return vmNs === currentRecord?.namespace;
              })
              .map((vm: any) => ({ value: vm.id || vm.InstanceId, label: vm.name || vm.InstanceName || vm.id || vm.InstanceId }))} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="总线" name="bus" initialValue="virtio">
            <Select options={['virtio', 'sata', 'scsi'].map(v => ({ value: v, label: v }))} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="PVC"><Input value={currentRecord?.name} disabled /></Form.Item>
      </StdFormModal>

      {/* 4. Export */}
      <StdFormModal
        title="导出为镜像" open={exportOpen} onCancel={() => setExportOpen(false)}
        okText="导出"
        form={exportForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            await exportHarvesterImageFromVolume(cloudId, currentRecord.namespace, currentRecord.name, {
              displayName: v.displayName,
              targetStorageClassName: v.targetStorageClassName
            });
            message.success('任务已提交');
            setExportOpen(false);
          } catch (e: any) { message.error(e.message || '导出失败'); }
        }}
      >
          <Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="存储类" name="targetStorageClassName"><Select allowClear options={storageClasses.map(s => {
            const n = s?.metadata?.name || s?.name;
            return { value: n, label: n };
          }).filter(x => x.value && !isSystemStorageClass(x.value))} style={{ width: '100%' }} /></Form.Item>
      </StdFormModal>

      {/* 5. Snapshot */}
      <StdFormModal
        title="创建快照" open={snapshotOpen} onCancel={() => setSnapshotOpen(false)}
        okText="创建"
        form={snapshotForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            // Generate ID: id-vs-{11 random chars}
            const id = `id-vs-${Math.random().toString(36).substring(2, 13)}`;
            await createHarvesterVolumeSnapshot(cloudId, currentRecord.namespace, currentRecord.name, {
              name: id,
              snapshotClassName: 'longhorn-snapshot',
              alias: v.name // Use user input as alias
            });
            message.success('创建成功');
            setSnapshotOpen(false);
          } catch (e: any) { message.error(e.message || '创建失败'); }
        }}
      >
          <Form.Item label="快照名称" name="name"><Input placeholder="留空自动生成" /></Form.Item>
      </StdFormModal>

      {/* 6. Edit */}
      <StdFormModal
        title="编辑配置" open={editOpen} onCancel={() => setEditOpen(false)}
        okText="保存"
        form={editForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            await updateHarvesterVolume(cloudId, currentRecord.namespace, currentRecord.name, {
              sizeGi: Number(v.sizeGi)
            });
            message.success('更新成功');
            setEditOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '更新失败'); }
        }}
      >
          <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
      </StdFormModal>

      {/* 7. Clone */}
      <StdFormModal
        title="克隆" open={cloneOpen} onCancel={() => setCloneOpen(false)}
        okText="克隆"
        form={cloneForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            await cloneHarvesterVolume(cloudId, currentRecord.namespace, currentRecord.name, {
              targetNamespace: v.targetNamespace,
              newName: v.newName,
              sizeGi: Number(v.sizeGi),
              storageClassName: v.storageClassName,
              fromSnapshotName: v.fromSnapshotName,
              accessModes: v.accessModes,
              volumeMode: v.volumeMode
            });
            message.success('克隆成功');
            setCloneOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '克隆失败'); }
        }}
      >
          <Form.Item label="目标命名空间" name="targetNamespace"><Select options={nsOptions} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="新卷名称" name="newName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="容量(GB)" name="sizeGi"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="访问模式" name="accessModes"><Select mode="multiple" options={['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany'].map(v => ({ value: v, label: v }))} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="卷类型" name="volumeMode"><Select options={['Block', 'Filesystem'].map(v => ({ value: v, label: v }))} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="存储类" name="storageClassName"><Select allowClear options={storageClasses.map(s => {
            const n = s?.metadata?.name || s?.name;
            return { value: n, label: n };
          }).filter(x => x.value)} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="来源快照" name="fromSnapshotName"><Input placeholder="可选" /></Form.Item>
      </StdFormModal>

      {/* 8. Resource Drawer */}
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="PersistentVolumeClaim"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default VolumesSection;
