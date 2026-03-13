import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Badge, Button, Dropdown, Input, Select, Table, Tag } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { fetchCloudProviderEcs } from '../../../../services/api';
import { isPublicNamespace, isSystemNamespace } from '../../../../utils/harvesterUtils';

type Props = {
  cloudId: string;
  isTenant?: boolean;
};

const getVmStatus = (vm: any) => {
  const status = vm?.status?.printableStatus || vm?.status?.phase || vm?.status || '';
  const s = String(status).toLowerCase();
  
  // 判断是否创建中
  const isCreating = !vm?.status?.ready || (!vm?.status?.printableStatus && vm?.metadata?.creationTimestamp);
  
  if (s === 'running' || s === 'started') {
    return { phase: 'ready', text: '运行中' as const, isCreating: false };
  }
  if (s === 'stopped' || s === 'stopped') {
    return { phase: 'ready', text: '已停止' as const, isCreating: false };
  }
  if (s === 'failed' || s === 'error') {
    return { phase: 'failed', text: '失败' as const, isCreating: false };
  }
  if (isCreating) {
    return { phase: 'pending', text: '创建中' as const, isCreating: true };
  }
  return { phase: 'pending', text: s || '未知' as const, isCreating: false };
};

const VmCreateTasksSection: React.FC<Props> = ({ cloudId, isTenant }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [vms, setVms] = useState<any[]>([]);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  const timerRef = useRef<any>(null);

  // 过滤出最近创建的虚拟机（24小时内）
  const normalizeVms = useMemo(() => {
    const list = Array.isArray(vms) ? vms : [];
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000; // 24小时前的时间戳

    return list
      .map((vm: any) => {
        const raw = vm?.rawData || vm;
        return raw;
      })
      .filter((raw: any) => {
        const creationTimestamp = raw?.metadata?.creationTimestamp;
        if (!creationTimestamp) return false;
        
        const createTime = Date.parse(String(creationTimestamp));
        if (!Number.isFinite(createTime)) return false;
        
        // 只显示最近24小时内创建的虚拟机
        return createTime >= twentyFourHoursAgo;
      });
  }, [vms]);

  const dataSource = useMemo(() => {
    return normalizeVms.map((vm: any) => {
      const ns = String(vm?.metadata?.namespace || '');
      const name = String(vm?.metadata?.name || '');
      const alias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || name;
      const status = getVmStatus(vm);
      const cpu = vm?.spec?.template?.spec?.domain?.cpu?.cores || vm?.spec?.template?.spec?.domain?.resources?.requests?.['cpu'] || '-';
      const memory = vm?.spec?.template?.spec?.domain?.resources?.requests?.['memory'] || '-';

      return {
        key: vm?.metadata?.uid || `${ns}/${name}`,
        namespace: ns,
        name: name,
        alias: alias,
        cpu: cpu,
        memory: memory,
        status: status,
        vmRaw: vm,
        creationTimestamp: vm?.metadata?.creationTimestamp || '',
      };
    }).sort((a, b) => {
      const parseTs = (t: any) => {
        if (!t) return 0;
        const n = Date.parse(String(t));
        return Number.isFinite(n) ? n : 0;
      };
      return parseTs(b.creationTimestamp) - parseTs(a.creationTimestamp);
    });
  }, [normalizeVms]);

  const filtered = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => {
        const ns = String(x?.namespace || '').toLowerCase();
        return !isPublicNamespace(ns) && !isSystemNamespace(ns);
      });
    }
    if (statusFilter !== 'all') {
      d = d.filter((x: any) => {
        const st = x.status;
        if (statusFilter === 'pending') return st.phase === 'pending';
        if (statusFilter === 'failed') return st.phase === 'failed';
        if (statusFilter === 'ready') return st.phase === 'ready';
        return true;
      });
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => {
        return (
          String(x.namespace || '').toLowerCase().includes(k) ||
          String(x.name || '').toLowerCase().includes(k) ||
          String(x.alias || '').toLowerCase().includes(k)
        );
      });
    }
    return d;
  }, [dataSource, isTenant, keyword, statusFilter]);

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    try {
      const res = await fetchCloudProviderEcs(cloudId, force);
      const items: any[] = Array.isArray((res as any)?.data) ? (res as any).data : [];
      setVms(items);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, message]);

  const openDrawer = (record: any, kind: string, viewLink: string, tab: string = 'detail') => {
    const r = { ...(record || {}), kind, links: { ...(record?.links || {}), view: viewLink } };
    setDrawerRecord(r);
    setDrawerActiveTab(tab);
    setDrawerVisible(true);
  };

  useEffect(() => {
    refresh(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const hasPending = filtered.some((x: any) => {
      return x.status.phase === 'pending';
    });
    if (!hasPending) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        refresh(true);
      }, 10000);
    }
    return () => {};
  }, [filtered, refresh]);

  const columns: any[] = [
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', ellipsis: true },
    { 
      title: '虚拟机名称', 
      key: 'name',
      render: (_: any, r: any) => {
        const displayName = r.alias && r.alias !== r.name ? `${r.alias} (${r.name})` : r.name;
        return <span className="cell-link" onClick={() => {
          const ns = String(r.namespace || '');
          const name = String(r.name || '');
          const view = `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachines/${encodeURIComponent(name)}`;
          openDrawer(r.vmRaw, 'VirtualMachine', view, 'detail');
        }}>{displayName}</span>;
      }
    },
    { 
      title: 'CPU', 
      dataIndex: 'cpu', 
      key: 'cpu',
      render: (cpu: any) => cpu || '-'
    },
    { 
      title: '内存', 
      dataIndex: 'memory', 
      key: 'memory',
      render: (mem: any) => mem || '-'
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const st = r.status;
        if (st.phase === 'ready') return <Badge status="success" text={st.text} />;
        if (st.phase === 'failed') return <Badge status="error" text={st.text} />;
        return <Badge status="processing" text={st.text} />;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (t: any) => {
        const n = Date.parse(String(t || ''));
        return Number.isFinite(n) ? new Date(n).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, r: any) => {
        const ns = String(r.namespace || '');
        const name = String(r.name || '');
        const items: MenuProps['items'] = [
          {
            key: 'vm_detail',
            label: '虚拟机详情',
            onClick: () => {
              const view = `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachines/${encodeURIComponent(name)}`;
              openDrawer(r.vmRaw, 'VirtualMachine', view, 'detail');
            }
          },
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button className="row-actions-trigger" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            allowClear
            placeholder="关键字"
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          />
          <Select
            placeholder="状态"
            className="toolbar-filter-sm"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'pending', label: '创建中' },
              { value: 'ready', label: '已完成' },
              { value: 'failed', label: '失败' },
            ]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('all');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={
        <>
          <Button icon={<ReloadOutlined />} onClick={() => refresh(true)} loading={loading} />
        </>
      }
    >
      <div style={{ marginBottom: 8 }}>
        <Tag color="green">说明：展示最近24小时内创建的虚拟机，用于跟踪新建虚拟机任务进度。</Tag>
      </div>
      <Table
        className="std-table"
        bordered
        rowKey={(r: any) => r.key}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ size: 'small', showQuickJumper: false }}
      />

      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType="HarvesterResource"
        record={drawerRecord}
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
      />
    </PageDetailSection>
  );
};

export default VmCreateTasksSection;
