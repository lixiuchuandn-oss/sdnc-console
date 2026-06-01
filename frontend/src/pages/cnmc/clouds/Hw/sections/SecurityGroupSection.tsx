import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Space, Table, Tooltip, Typography } from 'antd';
import { SafetyCertificateOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderSecurityGroups } from '../../../../../services/securityGroups';
import { deleteHuaweiCloudSecurityGroup } from '../../../../../services/huaweiApi';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type SecurityGroupSectionProps = {
  cloudId: string;
  secGroups: any[];
  ecs: any[];
  onSetSecGroups: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenRuleDrawer: (sg: any) => void;
  onOpenRefsDrawer: (sg: any) => void;
  onOpenCreate?: () => void;
};

const parseSgList = (json: any): any[] =>
  (json?.data?.security_groups) || (json?.security_groups) || (json?.data?.securityGroups) || (json?.securityGroups) || [];

const SecurityGroupSection: React.FC<SecurityGroupSectionProps> = ({ cloudId, secGroups, ecs, onSetSecGroups, onOpenDetail, onOpenRuleDrawer, onOpenRefsDrawer, onOpenCreate }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderSecurityGroups(cloudId);
      onSetSecGroups(parseSgList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filteredSgs = useMemo(() => {
    const list = Array.isArray(secGroups) ? secGroups : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.description || ''} ${r?.vpc_id || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [secGroups, keyword]);

  const refCount = (sg: any): number => {
    const sgName = String(sg?.name || '').trim().toLowerCase();
    const sgId = String(sg?.id || '').trim();
    let cnt = 0;
    const uniq = new Set<string>();
    for (const s of (ecs || [])) {
      const sid = String(s?.id || '');
      const names = Array.isArray(s?.security_groups) ? (s.security_groups as any[]).map(x => String(x?.name || x?.Name || '').trim().toLowerCase()) : [];
      if ((sgName && names.includes(sgName)) || (!sgName && sgId && names.includes(sgId.toLowerCase()))) {
        if (!uniq.has(sid)) { uniq.add(sid); cnt++; }
      }
    }
    return cnt;
  };

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-';
        const id = r?.id || r?.SecurityGroupId || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '安全组规则', key: 'rule_count', width: 110,
      render: (_: any, r: any) => { const l: any[] = Array.isArray(r?.security_group_rules) ? r.security_group_rules : []; return (<Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpenRuleDrawer(r)}>{l.length} 条</Button>); },
    },
    {
      title: '关联实例', key: 'ref_instances', width: 100,
      render: (_: any, r: any) => { const n = refCount(r); return (<Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpenRefsDrawer(r)}>{n}</Button>); },
    },
    {
      title: '规则统计', key: 'stats', width: 180,
      render: (_: any, r: any) => {
        const list: any[] = Array.isArray(r?.security_group_rules) ? r?.security_group_rules : [];
        const inCnt = list.filter((x: any) => String(x?.direction || '').toLowerCase() === 'ingress').length;
        const outCnt = list.filter((x: any) => String(x?.direction || '').toLowerCase() === 'egress').length;
        return <Typography.Text type="secondary" style={{ fontSize: 12 }}>入站 {inCnt} · 出站 {outCnt}</Typography.Text>;
      },
    },
    { title: '描述', key: 'desc', ellipsis: true, render: (_: any, r: any) => r?.description || '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'rules', label: '管理规则' }, { key: 'detail', label: '详情' }, { key: 'delete', label: '删除', danger: true }]}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'rules') { onOpenRuleDrawer(r); return; }
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || r?.SecurityGroupId || '-'; onOpenDetail('sg', `安全组 ${name}（${id}）`, r); return; }
            if (key === 'delete') {
              const gid = r?.id || r?.SecurityGroupId;
              if (!gid) { message.error('缺少安全组标识'); return; }
              Modal.confirm({
                title: '确定删除该安全组?', content: `ID: ${gid}`, okText: '确认删除', okType: 'danger', cancelText: '取消',
                onOk: async () => { try { await deleteHuaweiCloudSecurityGroup(cloudId, String(gid)); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
              });
            }
          }}
        />
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [ecs, cloudId, onOpenDetail, onOpenRuleDrawer, onOpenRefsDrawer]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 描述" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          {onOpenCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建安全组</Button>}
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id || r.SecurityGroupId}
        dataSource={filteredSgs}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <SafetyCertificateOutlined />;
export const Label = '安全组';
export default SecurityGroupSection;
