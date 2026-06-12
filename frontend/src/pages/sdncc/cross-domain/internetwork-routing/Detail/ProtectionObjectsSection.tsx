import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, message, Table, Tag } from 'antd';
import PageDetailSection from '../../../../../components/PageDetailSection';
import {
  createCsmAsset,
  fetchCsmAssets,
  fetchCsmPoolId,
} from '../../../../../services/api';
import type { SecurityDomain } from '../index';

const normalizeAssetItems = (raw: any): any[] => {
  const items =
    Array.isArray(raw?.data?.items) ? raw.data.items :
    Array.isArray(raw?.items) ? raw.items :
    Array.isArray(raw?.data?.page) ? raw.data.page :
    Array.isArray(raw?.data) ? raw.data :
    Array.isArray(raw) ? raw :
    [];
  return items;
};

const collectTowerCidrs = (domain: SecurityDomain): string[] => {
  const fromList = Array.isArray(domain.cidr4) ? domain.cidr4 : [];
  const single = String(domain.cidr || '').trim();
  const merged = [...fromList, single]
    .flatMap((c) => String(c || '').split(/[\s,;]+/))
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
};

type Props = {
  domain: SecurityDomain;
};

const ProtectionObjectsSection: React.FC<Props> = ({ domain }) => {
  const cloudId = String(domain.csmCloudId || '').trim();
  const linkedCsmDomainId = String(domain.linkedCsmSecurityDomainId || '').trim();
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [poolId, setPoolId] = useState<string | undefined>();

  const towerCidrs = useMemo(() => collectTowerCidrs(domain), [domain]);

  const loadAssets = useCallback(async () => {
    const projected = Array.isArray((domain as any).csmProtectionObjects)
      ? (domain as any).csmProtectionObjects
      : null;
    if (projected) {
      setAssets(projected);
      return;
    }
    if (!cloudId) {
      setAssets([]);
      return;
    }
    setLoading(true);
    try {
      let pid = poolId;
      if (!pid) {
        try {
          const pres = await fetchCsmPoolId(cloudId);
          pid = pres?.data?.pool_id ? String(pres.data.pool_id) : undefined;
          if (pid) setPoolId(pid);
        } catch {
          /* pool_id 可选 */
        }
      }
      const raw = await fetchCsmAssets(cloudId, pid ? { pool_id: pid, page_size: 1000 } : { page_size: 1000 });
      setAssets(normalizeAssetItems(raw));
    } catch (e: any) {
      message.error(e?.message || '加载 CSM 防护对象失败');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [cloudId, poolId, domain]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const syncTowerCidrs = async () => {
    if (!cloudId) {
      message.warning('未配置 CSM 资源池');
      return;
    }
    if (!linkedCsmDomainId) {
      message.warning('请先关联 CSM 安全域');
      return;
    }
    if (towerCidrs.length === 0) {
      message.warning('本网际路由域未配置防护目标 CIDR');
      return;
    }
    setSyncing(true);
    try {
      let pid = poolId;
      if (!pid) {
        const pres = await fetchCsmPoolId(cloudId);
        pid = pres?.data?.pool_id ? String(pres.data.pool_id) : undefined;
        if (pid) setPoolId(pid);
      }
      if (!pid) {
        message.error('未检测到安全资源池 ID (pool_id)，无法同步');
        return;
      }
      const existing = new Set(
        assets
          .filter((a) => String(a?.type || '').toLowerCase() === 'subnet')
          .map((a) => String(a?.value || '').trim())
          .filter(Boolean),
      );
      let ok = 0;
      let skip = 0;
      let fail = 0;
      for (const cidr of towerCidrs) {
        if (existing.has(cidr)) {
          skip += 1;
          continue;
        }
        try {
          await createCsmAsset(cloudId, { type: 'subnet', ip_type: 'ipv4', value: cidr }, { pool_id: pid });
          ok += 1;
          existing.add(cidr);
        } catch {
          fail += 1;
        }
      }
      await loadAssets();
      if (ok && !fail) message.success(`已同步 ${ok} 条 CIDR 至 CSM${skip ? `（${skip} 条已存在）` : ''}`);
      else if (ok) message.warning(`部分同步成功：新增 ${ok}，跳过 ${skip}，失败 ${fail}`);
      else if (skip && !fail) message.info('Tower CIDR 均已存在于 CSM');
      else message.error('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const columns = [
    {
      title: '防护对象',
      dataIndex: 'value',
      key: 'value',
      render: (t: string) => t || '-',
    },
    {
      title: '资产 ID',
      key: 'id',
      render: (_: any, r: any) => r?.network_id || r?.id || r?.Id || '-',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => {
        const map: Record<string, string> = { subnet: '子网', ip: 'IP', vpc: 'VPC' };
        return <Tag color="blue">{map[String(t || '').toLowerCase()] || t || '-'}</Tag>;
      },
    },
    {
      title: 'IP 类型',
      dataIndex: 'ip_type',
      key: 'ip_type',
      render: (t: string) => t || '-',
    },
    {
      title: '端口',
      dataIndex: 'port',
      key: 'port',
      render: (t: string) => t || '-',
    },
  ];

  if (!linkedCsmDomainId) {
    return (
      <PageDetailSection>
        <Empty description="请先在编辑网际路由域时关联唯一的 CSM 安全域；关联后可查看与同步防护对象" />
      </PageDetailSection>
    );
  }

  if (!cloudId) {
    return (
      <PageDetailSection>
        <Empty description="未绑定 CSM 资源池，无法拉取防护对象" />
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection
      onRefresh={loadAssets}
      refreshLoading={loading}
      toolbarRight={
        <Button type="primary" loading={syncing} onClick={() => void syncTowerCidrs()}>
          同步 Tower CIDR 至 CSM
        </Button>
      }
    >
      <div style={{ marginBottom: 12, fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
        关联 CSM 安全域：{linkedCsmDomainId}
        {towerCidrs.length > 0 ? ` · Tower 防护 CIDR：${towerCidrs.join('，')}` : ''}
      </div>
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => String(r?.network_id || r?.id || r?.value || Math.random())}
        loading={loading}
        dataSource={assets}
        columns={columns}
        pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: '暂无 CSM 防护对象，可点击「同步 Tower CIDR 至 CSM」' }}
      />
    </PageDetailSection>
  );
};

export default ProtectionObjectsSection;
