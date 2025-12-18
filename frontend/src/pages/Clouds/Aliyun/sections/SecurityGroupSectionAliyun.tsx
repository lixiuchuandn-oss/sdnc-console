import React, { useMemo, useState } from 'react';
import { App, Button, Input, Table, Modal } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { fetchCloudProviderSecurityGroups, deleteCloudProviderSecurityGroup } from '../../../../services/api';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';

type Props = {
  cloudId: string;
  secGroups: any[];
  onSetSecGroups: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate?: () => void;
  showLog?: boolean;
  raw?: any;
};

const SecurityGroupSectionAliyun: React.FC<Props> = ({ cloudId, secGroups, onSetSecGroups, onOpenDetail, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const filtered = useMemo(() => {
    const kn = keyword.trim().toLowerCase();
    return (Array.isArray(secGroups) ? secGroups : []).filter((g: any) => {
      const nm = String(g?.SecurityGroupName || g?.name || '').toLowerCase();
      const id = String(g?.SecurityGroupId || g?.id || '').toLowerCase();
      return !kn || nm.includes(kn) || id.includes(kn);
    });
  }, [secGroups, keyword]);
  const refresh = async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchCloudProviderSecurityGroups(cloudId);
      const list: any[] = json?.data?.SecurityGroups?.SecurityGroup || json?.SecurityGroups?.SecurityGroup || [];
      onSetSecGroups(Array.isArray(list) ? list : []);
      message.success('安全组已刷新');
    } catch (e: any) {
      message.error(e?.message || '查询安全组失败');
    }
  };
  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input placeholder="关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Button icon={<ReloadOutlined />} onClick={refresh} />
        </>
      )}
      asCard={false}
    >
      <Table
        rowKey={(r: any) => r?.SecurityGroupId || r?.id}
        columns={[
          { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.SecurityGroupName || r?.name || '-'}<br />{r?.SecurityGroupId || r?.id || '-'}</span>) },
          { title: '所属VPC', key: 'vpc', render: (_: any, r: any) => r?.VpcId || r?.vpc_id || '-' },
          { title: '描述', dataIndex: 'Description', key: 'desc', render: (_: any, r: any) => r?.Description || r?.description || '-' },
          { title: '操作', key: 'actions', render: (_: any, r: any) => {
            const items = [
              { key: 'detail', label: '详情' },
              { key: 'del', label: '删除' },
            ];
            return (
              <RowActionsButton
                items={items}
                onClick={async ({ key }: { key: string }) => {
                  if (key === 'detail') {
                    const name = r?.SecurityGroupName || r?.name || '-';
                    const id = r?.SecurityGroupId || r?.id || '-';
                    onOpenDetail('security_group', `安全组 ${name}（${id}）`, r);
                    return;
                  }
                  if (key === 'del') {
                    const id0 = r?.SecurityGroupId || r?.id;
                    if (!id0) return;
                    Modal.confirm({
                      title: '确定删除该安全组?',
                      content: `ID: ${id0}`,
                      onOk: async () => {
                        try {
                          await deleteCloudProviderSecurityGroup(cloudId, id0);
                          message.success('删除成功');
                          await refresh();
                        } catch (e: any) {
                          message.error(e?.message || '删除失败');
                        }
                      }
                    });
                  }
                }}
              />
            );
          } },
        ] as any}
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
      />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </PageDetailSection>
  );
};

export const Icon = <SafetyCertificateOutlined />;
export const Label = '安全组';
export default SecurityGroupSectionAliyun;
