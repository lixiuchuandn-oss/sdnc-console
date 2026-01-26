import React, { useMemo, useState } from 'react';
import { App, Button, Input, Table, Modal } from 'antd';
import { MoreOutlined, GlobalOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchCloudProviderEips } from '../../../../services/aliyunApi';
import { statusTag } from '../../Hw/components/Common';

type EipSectionAliyunProps = {
  cloudId: string;
  eips: any[];
  onSetEips: (list: any[]) => void;
  showLog?: boolean;
  raw?: any;
};

const EipSectionAliyun: React.FC<EipSectionAliyunProps> = ({ cloudId, eips, onSetEips, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');

  const filteredEips = useMemo(() => {
    const list = Array.isArray(eips) ? eips : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.IpAddress || r?.public_ip_address || ''} ${r?.AllocationId || r?.id || ''} ${r?.InstanceId || r?.instance_id || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [eips, keyword]);

  const columns = useMemo(() => ([
    { title: '公网IP/ID', key: 'ip_id', render: (_: any, r: any) => (<span>{r?.IpAddress || r?.public_ip_address || '-'}<br />{r?.AllocationId || r?.id || '-'}</span>) },
    { title: '绑定实例/端口', key: 'bind', render: (_: any, r: any) => { const inst = r?.InstanceId || r?.instance_id || ''; const port = r?.PortId || r?.port_id || ''; return (<span>{inst || '-'}<br />{port || '-'}</span>); } },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [
        { key: 'detail', label: '详情' },
      ];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') {
              Modal.info({
                title: 'EIP详情',
                width: 600,
                content: (
                  <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10 }}>
                    {JSON.stringify(r, null, 2)}
                  </pre>
                ),
                maskClosable: true,
              });
            }
          }}
        />
      );
    } },
  ]), []);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
        </>
      )}
      toolbarRight={(
        <>
          <ResourceActionsDropdown
            items={[{ key: 'refresh', label: '刷新' }]}
            onClick={async ({ key }) => {
              if (key === 'refresh') {
                try {
                  const json = await fetchCloudProviderEips(cloudId);
                  const eipList: any[] = (json?.data?.publicIps) || (json?.publicIps) || (json?.data?.publicips) || (json?.publicips) || [];
                  onSetEips(Array.isArray(eipList) ? eipList : []);
                } catch (e: any) { message.error(e?.message || '刷新失败'); }
              }
            }}
          />
        </>
      )}
      asCard={false}
    >
      <Table bordered rowKey={(r: any) => r.AllocationId || r.id} dataSource={filteredEips} columns={columns as any} pagination={{ pageSize: 10, size: 'default' }} />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </PageDetailSection>
  );
};

export const Icon = <GlobalOutlined />;
export const Label = 'EIP';
export default EipSectionAliyun;
