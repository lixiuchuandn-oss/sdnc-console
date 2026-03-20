import React, { useMemo, useState } from 'react';
import { App, Button, Input, Space, Table, Tag, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';

interface Props {
  cloudId: string;
  vms: any[];
  loading?: boolean;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  bordered?: boolean;
  isTenant?: boolean;
}

type UsbDevice = {
  name: string;
  deviceName: string;
};

type Row = {
  key: string;
  vm: any;
  namespace: string;
  name: string;
  displayName: string;
  status: string;
  usbDevices: UsbDevice[];
};

const UsbSection: React.FC<Props> = ({ cloudId, vms, loading = false, onRefresh, bordered = true, isTenant = false }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => {
    const kw = String(keyword || '').trim().toLowerCase();
    const list = Array.isArray(vms) ? vms : [];

    const unwrap = (r: any) => r?.rawData || r?.raw || r?.data || r;
    const readNamespace = (r: any) => {
      const raw = unwrap(r);
      return raw?.metadata?.namespace || raw?.namespace || r?.metadata?.namespace || r?.namespace || '';
    };
    const readName = (r: any) => {
      const raw = unwrap(r);
      return raw?.metadata?.name || raw?.name || r?.metadata?.name || r?.name || '';
    };
    const readDisplayName = (r: any) => {
      const raw = unwrap(r);
      return raw?.metadata?.annotations?.['tower.io/alias'] || raw?.InstanceName || r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || readName(r) || '';
    };
    const readStatus = (r: any) => {
      const raw = unwrap(r);
      if (typeof raw?.status === 'string') return raw.status;
      if (typeof r?.status === 'string') return r.status;
      return raw?.status?.printableStatus || raw?.status?.phase || raw?.Status || r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    };
    const readUsbDevices = (r: any): UsbDevice[] => {
      const raw = unwrap(r);

      try {
        const allocRaw = raw?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
        if (allocRaw) {
          const alloc = typeof allocRaw === 'string' ? JSON.parse(allocRaw) : allocRaw;
          const hostDevices = Array.isArray(alloc?.devices?.hostDevices) ? alloc.devices.hostDevices : [];
          const usb = hostDevices
            .filter((d: any) => String(d?.deviceName || d?.name || '').toLowerCase().includes('usb'))
            .map((d: any) => ({
              name: String(d?.name || ''),
              deviceName: String(d?.deviceName || ''),
            }))
            .filter((d: UsbDevice) => !!(d.name || d.deviceName));
          if (usb.length > 0) return usb;
        }
      } catch {}

      const hostDevices = raw?.spec?.template?.spec?.domain?.devices?.hostDevices || raw?.spec?.domain?.devices?.hostDevices || [];
      const arr = Array.isArray(hostDevices) ? hostDevices : [];
      return arr
        .filter((d: any) => String(d?.deviceName || d?.name || '').toLowerCase().includes('usb'))
        .map((d: any) => ({
          name: String(d?.name || ''),
          deviceName: String(d?.deviceName || ''),
        }))
        .filter((d: UsbDevice) => !!(d.name || d.deviceName));
    };

    const mapped: Row[] = list.map((vm: any) => {
      const ns = readNamespace(vm);
      const name = readName(vm);
      const usbDevices = readUsbDevices(vm);
      return {
        key: `${ns}/${name}` || String(vm?.metadata?.uid || vm?.InstanceId || vm?.id || Math.random()),
        vm,
        namespace: ns,
        name,
        displayName: readDisplayName(vm),
        status: String(readStatus(vm) || 'Unknown'),
        usbDevices,
      };
    });

    const filtered = mapped.filter(r => r.usbDevices.length > 0);
    if (!kw) return filtered;

    return filtered.filter(r => {
      const f = `${r.namespace} ${r.name} ${r.displayName} ${r.status} ${r.usbDevices.map(x => `${x.name} ${x.deviceName}`).join(' ')}`.toLowerCase();
      return f.includes(kw);
    });
  }, [keyword, vms]);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh(true);
      message.success('已刷新');
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const columns = useMemo(() => {
    return [
      {
        title: '云主机',
        key: 'vm',
        ellipsis: true,
        render: (_: any, r: Row) => {
          const title = `${r.displayName || r.name || '-'} (${r.namespace}/${r.name})`;
          return (
            <Tooltip title={title}>
              <span>{r.displayName || r.name || '-'}</span>
            </Tooltip>
          );
        },
      },
      { title: '命名空间', key: 'namespace', width: 160, ellipsis: true, dataIndex: 'namespace' as const, render: (v: any) => v || '-' },
      { title: '状态', key: 'status', width: 120, ellipsis: true, dataIndex: 'status' as const, render: (v: any) => v || '-' },
      {
        title: 'USB 设备',
        key: 'usb',
        render: (_: any, r: Row) => {
          if (!r.usbDevices || r.usbDevices.length === 0) return '-';
          return (
            <Space size={[6, 6]} wrap>
              {r.usbDevices.map((d, idx) => {
                const label = d.name || d.deviceName || '-';
                const tip = [d.name, d.deviceName].filter(Boolean).join(' / ');
                return (
                  <Tooltip key={`${r.key}-${idx}`} title={tip}>
                    <Tag>{label}</Tag>
                  </Tooltip>
                );
              })}
            </Space>
          );
        },
      },
    ];
  }, []);

  return (
    <PageDetailSection
      asCard={false}
      bordered={bordered}
      title="USB 设备"
      toolbarLeft={(
        <Input
          allowClear
          placeholder="虚拟机/USB设备"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          style={{ width: 320 }}
        />
      )}
      toolbarRight={(
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing} disabled={!onRefresh}>
          刷新
        </Button>
      )}
    >
      <Table
        className="std-table"
        bordered={false}
        columns={columns as any}
        dataSource={rows}
        loading={loading}
        rowKey="key"
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
    </PageDetailSection>
  );
};

export default UsbSection;
