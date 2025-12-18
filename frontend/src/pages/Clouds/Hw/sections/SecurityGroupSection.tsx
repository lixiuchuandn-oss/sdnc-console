import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Space, Table } from 'antd';
import { MoreOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { fetchCloudProviderSecurityGroups, deleteHuaweiCloudSecurityGroup } from '../../../../services/api';
import SharedToolbar from '../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../components/PageDetailSection';

type SecurityGroupSectionProps = {
  cloudId: string;
  secGroups: any[];
  ecs: any[];
  onSetSecGroups: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenRuleDrawer: (sg: any) => void;
  onOpenRefsDrawer: (sg: any) => void;
};

const SecurityGroupSection: React.FC<SecurityGroupSectionProps> = ({ cloudId, secGroups, ecs, onSetSecGroups, onOpenDetail, onOpenRuleDrawer, onOpenRefsDrawer }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');

  const filteredSgs = useMemo(() => {
    const list = Array.isArray(secGroups) ? secGroups : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const tags = r?.tags;
      const getFromTags = (k: string) => {
        if (Array.isArray(tags)) {
          const it = tags.find((t: any) => String(t?.key || t?.Key || '').toLowerCase() === k);
          return it?.value ?? it?.Value ?? '';
        }
        if (tags && typeof tags === 'object') {
          const keys = Object.keys(tags || {});
          const hit = keys.find((x) => String(x || '').toLowerCase() === k);
          return hit ? (tags as any)[hit] : '';
        }
        return '';
      };
      const plName = getFromTags('cm.pipeline_name') || getFromTags('pipeline_name') || getFromTags('pipeline') || r?.metadata?.['cm.pipeline_name'] || r?.metadata?.pipeline_name || '';
      const plId = getFromTags('cm.pipeline_id') || getFromTags('pipeline_id') || r?.metadata?.['cm.pipeline_id'] || r?.metadata?.pipeline_id || '';
      const plText = `${plName || ''} ${plId || ''}`;
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.description || ''} ${r?.vpc_id || ''} ${plText}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [secGroups, keyword]);

  const columns = useMemo(() => {
    const ruleStatsText = (r: any) => {
      const list: any[] = Array.isArray(r?.security_group_rules) ? r?.security_group_rules : [];
      const inCnt = list.filter((x: any) => String(x?.direction || '').toLowerCase() === 'ingress').length;
      const outCnt = list.filter((x: any) => String(x?.direction || '').toLowerCase() === 'egress').length;
      return `入站: ${inCnt} 条；出站: ${outCnt} 条`;
    };
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
    return ([
      { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.name || '-'}<br />{r?.id || r?.SecurityGroupId || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.name || ''); const bn = String(b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.id || a?.SecurityGroupId || '').localeCompare(String(b?.id || b?.SecurityGroupId || '')); } },
      { title: '安全组规则', key: 'rule_count', render: (_: any, r: any) => { const l: Array<any> = Array.isArray(r?.security_group_rules) ? r.security_group_rules : []; const cnt = l.length; return (<Button type="link" size="small" onClick={() => onOpenRuleDrawer(r)}>{cnt}</Button>); }, sorter: (a: any, b: any) => { const f = (x: any) => { const l: Array<any> = Array.isArray(x?.security_group_rules) ? x.security_group_rules : []; return l.length; }; return f(a) - f(b); } },
      { title: '关联实例', key: 'ref_instances', render: (_: any, r: any) => { const n = refCount(r); return (<Button type="link" size="small" onClick={() => onOpenRefsDrawer(r)}>{n}</Button>); }, sorter: (a: any, b: any) => refCount(a) - refCount(b) },
      { title: '规则统计', key: 'stats', render: (_: any, r: any) => ruleStatsText(r) },
      { title: '操作', key: 'actions', render: (_: any, r: any) => {
        const items = [ { key: 'detail', label: '详情' }, { key: 'delete', label: '删除', danger: true } ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || r?.SecurityGroupId || '-'; onOpenDetail('sg', `安全组 ${name}（${id}）`, r); }
              if (key === 'delete') {
                try {
                  const gid = r?.id || r?.SecurityGroupId;
                  if (!gid) { message.error('缺少安全组标识'); return; }
                  await deleteHuaweiCloudSecurityGroup(cloudId, String(gid));
                  const json = await fetchCloudProviderSecurityGroups(cloudId).catch(() => null);
                  const sgList: any[] = (json?.data?.security_groups) || (json?.security_groups) || (json?.data?.securityGroups) || (json?.securityGroups) || [];
                  onSetSecGroups(Array.isArray(sgList) ? sgList : []);
                  message.success('删除成功');
                } catch (e: any) { message.error(e?.message || '删除失败'); }
              }
            }}
          />
        );
      } },
    ]);
  }, [ecs, cloudId, onOpenDetail, onOpenRuleDrawer, onOpenRefsDrawer]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          </>
        )}
        right={(
          <>
            <Dropdown
              menu={{
                items: [{ key: 'refresh', label: '刷新' }],
                onClick: async ({ key }) => {
                  if (key === 'refresh') {
                    try {
                      const json = await fetchCloudProviderSecurityGroups(cloudId).catch(() => null);
                      const sgList: any[] = (json?.data?.security_groups) || (json?.security_groups) || (json?.data?.securityGroups) || (json?.securityGroups) || [];
                      onSetSecGroups(Array.isArray(sgList) ? sgList : []);
                    } catch (e: any) { message.error(e?.message || '刷新失败'); }
                  }
                }
              }}
            >
              <Button icon={<MoreOutlined style={{ transform: 'rotate(90deg)' }} />}>更多</Button>
            </Dropdown>
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id || r.SecurityGroupId} dataSource={filteredSgs} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <SafetyCertificateOutlined />;
export const Label = '安全组';
export default SecurityGroupSection;
