import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Form, Input, Select, Space, Tag, message, Typography } from 'antd';
import {
  DeleteOutlined,
  FileTextOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import PageContainer from '../../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { listSecurityDomains } from '../../../../../services/securityDomainApi';
import { fetchServices, deleteService, updateService, fetchAllInstances, fetchCloudProviderEcs } from '../../../../../services/api';
import { createACLRule } from '../../../../../services/virtualRouterApi';
import SecDomainAppWizardModal from '../modals/SecDomainAppWizardModal';
import AppDetailModal from '../modals/AppDetailModal';
import AppSecurityConfigModal from '../modals/AppSecurityConfigModal';
import { statusTag, typeTag } from '../components/appDisplayUtils';
import type { AppItem } from '../types/app';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

export type ApplicationListSectionHandle = {
  openCreateFromDiscoveryAsset: (asset: { value: string; port?: string }) => void;
};

export type ApplicationListCatalog = {
  apps: AppItem[];
  allDomains: any[];
};

export type ApplicationListSectionProps = {
  /** 供「资产发现」等兄弟域同步已加载目录（应用 + 安全域） */
  onCatalogChange?: (catalog: ApplicationListCatalog) => void;
};

const ApplicationListSection = forwardRef<ApplicationListSectionHandle, ApplicationListSectionProps>(
  function ApplicationListSection({ onCatalogChange }, ref) {
    const navigate = useNavigate();
    const [apps, setApps] = useState<AppItem[]>([]);
    const [domains, setDomains] = useState<{ id: string; name: string }[]>([]);
    const [allDomains, setAllDomains] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [editingApp, setEditingApp] = useState<AppItem | undefined>(undefined);

    const [securityOpen, setSecurityOpen] = useState(false);
    const [policyForm] = Form.useForm();
    const [currentApp, setCurrentApp] = useState<AppItem | null>(null);
    const [aclForm] = Form.useForm();
    const [aclContext, setAclContext] = useState<{
      vrId: string;
      sourceCandidates: string[];
      destCandidates: string[];
    } | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailApp, setDetailApp] = useState<AppItem | null>(null);
    const [allInstances, setAllInstances] = useState<any[]>([]);
    const [policyOptions, setPolicyOptions] = useState<{ label: string; value: string }[]>([]);
    const [allPolicies, setAllPolicies] = useState<any[]>([]);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
    const [ecsIpMap, setEcsIpMap] = useState<Record<string, string>>({});

    useImperativeHandle(ref, () => ({
      openCreateFromDiscoveryAsset: (asset) => {
        const partialApp: any = {
          name: `App-${asset.value}`,
          type: 'service_address',
          serviceAddresses: [{ protocol: 'TCP', ip: asset.value, port: asset.port || '80' }],
          instanceCount: 1,
          domainId: '',
          strategies: [],
          status: 'running',
          owner: 'admin',
          version: 'v1',
        };
        setEditingApp(partialApp);
        setCreateOpen(true);
      },
    }));

    useEffect(() => {
      onCatalogChange?.({ apps, allDomains });
    }, [apps, allDomains, onCatalogChange]);

    useEffect(() => {
      if (allDomains.length === 0 || apps.length === 0) return;
      const cloudIds = new Set<string>();
      apps.forEach((app) => {
        if (app.type === 'vm' || app.type === 'container' || app.type === 'mixed') {
          const dom = allDomains.find((d) => String(d.id) === String(app.domainId));
          if (dom?.cloudId) cloudIds.add(dom.cloudId);
        }
      });

      cloudIds.forEach((cid) => {
        fetchCloudProviderEcs(cid)
          .then((res: any) => {
            const list =
              res?.data?.Instances?.Instance ||
              res?.data?.servers ||
              res?.data?.InstanceSet ||
              res?.data ||
              [];
            const map: Record<string, string> = {};
            if (Array.isArray(list)) {
              list.forEach((inst: any) => {
                let ip = '';
                const pubArr = inst?.PublicIpAddress?.IpAddress;
                const pub =
                  Array.isArray(pubArr) && pubArr.length > 0
                    ? pubArr[0]
                    : inst?.EipAddress?.IpAddress ||
                      inst?.publicIpAddress ||
                      (Array.isArray(inst?.publicIps) ? inst.publicIps[0] : null);
                const priArr = inst?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                const pri =
                  Array.isArray(priArr) && priArr.length > 0
                    ? priArr[0]
                    : inst?.privateIpAddress ||
                      (Array.isArray(inst?.privateIps) ? inst.privateIps[0] : null);

                if (pub) ip = pub;
                else if (pri) ip = pri;

                const iid = inst?.InstanceId || inst?.id || inst?.uuid;
                if (iid && ip) {
                  const poolKey = `${String(cid)}::${String(iid)}`;
                  map[poolKey] = ip;
                  map[String(iid)] = ip;
                }
              });
            }
            setEcsIpMap((prev) => ({ ...prev, ...map }));
          })
          .catch(() => {});
      });
    }, [apps, allDomains]);

    const loadData = async () => {
      setLoading(true);
      try {
        const list = await listSecurityDomains();
        const opts = (Array.isArray(list) ? list : []).map((d: any) => ({
          id: String(d.id),
          name: String(d.name || d.id),
        }));
        setDomains(opts);
        setAllDomains(Array.isArray(list) ? list : []);
      } catch {}
      try {
        const raws = await fetchServices();
        const normalized = (Array.isArray(raws) ? raws : []).map((s: any) => {
          const parsedInstances: any[] = (() => {
            try {
              return s.instances ? JSON.parse(s.instances) : [];
            } catch {
              return [];
            }
          })();
          const rawType = String(s.type || '').toLowerCase();
          let type: AppItem['type'] = 'vm';
          if (rawType === 'container') type = 'container';
          else if (rawType === 'mixed') type = 'mixed';
          else if (rawType === 'service_address') type = 'service_address';

          const isServiceAddress = type === 'service_address';
          const instances = isServiceAddress ? [] : parsedInstances;
          let serviceAddresses: any[] = [];
          if (isServiceAddress) {
            if (s.serviceAddresses && Array.isArray(s.serviceAddresses)) {
              serviceAddresses = s.serviceAddresses;
            } else if (typeof s.serviceAddresses === 'string') {
              try {
                serviceAddresses = JSON.parse(s.serviceAddresses);
              } catch {}
            }

            if (serviceAddresses.length === 0 && parsedInstances.length > 0) {
              serviceAddresses = parsedInstances;
            }
          }

          return {
            id: s.id,
            name: s.name,
            domainId: s.domainId,
            domainName: s.domainName,
            type,
            instanceCount: isServiceAddress
              ? serviceAddresses.length
              : instances.length || Number(s.instanceCount || 0),
            status: s.status || 'running',
            strategies:
              typeof s.strategies === 'string'
                ? s.strategies
                    .split(',')
                    .map((x: string) => x.trim())
                    .filter(Boolean)
                : s.strategies || [],
            instances,
            serviceAddresses,
            servicePorts: (() => {
              try {
                return s.servicePorts
                  ? Array.isArray(s.servicePorts)
                    ? s.servicePorts
                    : JSON.parse(s.servicePorts)
                  : [];
              } catch {
                return [];
              }
            })(),
            description: s.description,
            owner: s.owner,
            version: s.version,
            policyIds:
              typeof s.policyIds === 'string'
                ? s.policyIds
                    .split(',')
                    .map((x: string) => x.trim())
                    .filter(Boolean)
                : s.policyIds || [],
          };
        });
        setApps(normalized);
      } catch {
        try {
          const saved = localStorage.getItem('security_apps');
          const parsed = saved ? JSON.parse(saved) : [];
          setApps(Array.isArray(parsed) ? parsed : []);
        } catch {
          setApps([]);
        }
      } finally {
        setLoading(false);
      }
      try {
        const res: any = await fetchAllInstances().catch(() => null);
        const list = Array.isArray(res?.data) ? res.data : [];
        setAllInstances(list);
      } catch {}
      try {
        const raw = localStorage.getItem('ct_policies_custom') || '[]';
        const arr = JSON.parse(raw) || [];
        setAllPolicies(Array.isArray(arr) ? arr : []);
        const opts = (Array.isArray(arr) ? arr : []).map((p: any) => ({
          label: p.name || p.id,
          value: p.id,
        }));
        setPolicyOptions(opts);
      } catch {
        setPolicyOptions([]);
        setAllPolicies([]);
      }
    };

    useEffect(() => {
      loadData();
    }, []);

    useEffect(() => {
      try {
        localStorage.setItem('security_apps', JSON.stringify(apps));
      } catch {}
    }, [apps]);

    const [keyword, setKeyword] = useState('');
    const [domainFilter, setDomainFilter] = useState<string | undefined>();
    const [statusFilter, setStatusFilter] = useState<string | undefined>();

    const filtered = useMemo(() => {
      const k = keyword.trim().toLowerCase();
      return apps.filter((a) => {
        if (k) {
          const inName = a.name.toLowerCase().includes(k);
          const inDesc = (a.description || '').toLowerCase().includes(k);
          if (!inName && !inDesc) return false;
        }
        if (domainFilter && a.domainId !== domainFilter) return false;
        if (statusFilter && a.status !== statusFilter) return false;
        return true;
      });
    }, [apps, keyword, domainFilter, statusFilter]);

    const openSecurity = (app: AppItem) => {
      setCurrentApp(app);
      policyForm.setFieldsValue({ policyIds: app.policyIds || [] });

      const dom = allDomains.find((d) => String(d.id) === String(app.domainId));
      const vrId =
        String(dom?.vrUuid || '').trim() || String(dom?.vrInstanceIds || '').split(',')[0]?.trim();
      const poolC = String((dom as any)?.cloudId || '').trim();

      const instanceIps = (app.instances || [])
        .flatMap((id) => {
          const sid = String(id);
          const candidates = allInstances.filter((x) => String(x.id) === sid);
          const ins = poolC
            ? candidates.find(
                (x) =>
                  String((x as any).cloudId || (x as any).cloud_id || '').trim() === poolC,
              ) || candidates[0]
            : candidates[0];
          const ips: string[] = Array.isArray((ins as any)?.privateIps) ? (ins as any).privateIps : [];
          return ips;
        })
        .filter(Boolean);
      const domainCidrs = [
        String(dom?.vrPrivateSubnetCidr || '').trim(),
        String(dom?.vrPublicSubnetCidr || '').trim(),
      ].filter(Boolean);

      const candidates = Array.from(new Set(['any', ...instanceIps, ...domainCidrs]));
      setAclContext({ vrId, sourceCandidates: candidates, destCandidates: candidates });

      aclForm.resetFields();
      if (instanceIps.length > 0) {
        aclForm.setFieldsValue({ destinationIp: instanceIps });
      }

      setSecurityOpen(true);
    };

    const openDetail = (app: AppItem) => {
      setDetailApp(app);
      setDetailOpen(true);
    };

    const submitPolicy = async () => {
      try {
        const vals = await policyForm.validateFields();
        if (!currentApp) return;

        const policyIds: string[] = (vals.policyIds || []).map((x: any) => String(x));
        const hasAbac = policyIds.some((pid: string) => {
          const p = allPolicies.find((x) => x.id === pid);
          return p?.conditions && (p.conditions.timeWindow || p.conditions.ipRange);
        });
        const strategies: ('RBAC' | 'ABAC')[] = hasAbac ? ['RBAC', 'ABAC'] : ['RBAC'];

        await updateService(currentApp.id, { strategies, policyIds });
        setApps((prev) =>
          prev.map((a) => (a.id === currentApp.id ? { ...a, strategies, policyIds } : a)),
        );
        message.success('授权策略已更新');
      } catch {}
    };

    const submitAcl = async () => {
      try {
        const vals = await aclForm.validateFields();
        if (!aclContext?.vrId) {
          message.error('当前安全域缺少 VR 标识，无法创建网络ACL');
          return;
        }
        const src = Array.isArray(vals.sourceIp)
          ? vals.sourceIp.join(',') || 'any'
          : vals.sourceIp || 'any';
        const dst = Array.isArray(vals.destinationIp)
          ? vals.destinationIp.join(',') || 'any'
          : vals.destinationIp || 'any';
        await createACLRule({
          vrId: aclContext.vrId,
          name: vals.name,
          description: vals.description,
          priority: Number(vals.priority || 100),
          action: vals.action || 'permit',
          protocol: vals.protocol || 'any',
          sourceIp: src,
          destinationIp: dst,
          sourcePort: vals.sourcePort || 'any',
          destinationPort: vals.destinationPort || 'any',
        });
        aclForm.resetFields();
        message.success('网络ACL创建成功');
      } catch {
        message.error('网络ACL创建失败');
      }
    };

    const removeApp = async (id: string) => {
      try {
        await deleteService(id);
        setApps((prev) => prev.filter((a) => a.id !== id));
        message.success('服务已删除');
      } catch {
        message.error('删除失败');
      }
    };

    const removeSelectedApps = async () => {
      if (!selectedRowKeys.length) return;
      try {
        await Promise.all(selectedRowKeys.map((id) => deleteService(id)));
        setApps((prev) => prev.filter((a) => !selectedRowKeys.includes(a.id)));
        setSelectedRowKeys([]);
        message.success('已批量删除所选应用');
      } catch {
        message.error('批量删除失败');
      }
    };

    const columns: any[] = [
      {
        title: '应用名称',
        dataIndex: 'name',
        key: 'name',
        render: (t: string, r: AppItem) => (
          <Space direction="vertical" size={0}>
            <span>{t}</span>
            {r.description && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {r.description}
              </Text>
            )}
          </Space>
        ),
      },
      { title: '版本', dataIndex: 'version', key: 'version' },
      { title: '负责人', dataIndex: 'owner', key: 'owner' },
      {
        title: '所属安全域',
        dataIndex: 'domainName',
        key: 'domainName',
        render: (t: string) => t || '-',
      },
      { title: '部署类型', dataIndex: 'type', key: 'type', render: (t: any) => typeTag(t) },
      {
        title: '协议/端口',
        key: 'protocolPort',
        render: (_: any, r: AppItem) => {
          let items: any[] = [];
          if (r.type === 'service_address') {
            items = r.serviceAddresses || [];
          } else {
            items = r.servicePorts || [];
          }
          if (!items.length) {
            if (r.type === 'vm') return 'all';
            return '-';
          }
          const unique = Array.from(
            new Set(items.map((p: any) => `${p.protocol || '-'}:${p.port || '-'}`)),
          );
          if (unique.length > 2) {
            return (
              <div style={{ fontSize: 12 }}>
                {unique.slice(0, 2).map((s: string, i: number) => (
                  <div key={i}>{s}</div>
                ))}
                <div style={{ color: '#999' }}>+{unique.length - 2} more</div>
              </div>
            );
          }
          return unique.map((s: string, i: number) => (
            <div key={i} style={{ fontSize: 12 }}>
              {s}
            </div>
          ));
        },
      },
      {
        title: 'IP地址',
        key: 'ip',
        render: (_: any, r: AppItem) => {
          let ips: string[] = [];
          if (r.type === 'service_address') {
            ips = (r.serviceAddresses || []).map((a) => a.ip).filter(Boolean);
          } else {
            const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
            const poolC = dom?.cloudId != null && dom?.cloudId !== '' ? String(dom.cloudId) : '';
            ips = (r.instances || [])
              .map((id) => {
                const sid = String(id);
                if (poolC) {
                  const k = `${poolC}::${sid}`;
                  if (ecsIpMap[k] != null && ecsIpMap[k] !== '') return ecsIpMap[k];
                }
                return ecsIpMap[sid];
              })
              .filter(Boolean) as string[];
          }
          if (!ips.length) return '-';
          const unique = Array.from(new Set(ips));
          if (unique.length > 2) {
            return (
              <div style={{ fontSize: 12 }}>
                {unique.slice(0, 2).map((ip: string, i: number) => (
                  <div key={i}>{ip}</div>
                ))}
                <div style={{ color: '#999' }}>+{unique.length - 2} more</div>
              </div>
            );
          }
          return unique.map((ip: string, i: number) => (
            <div key={i} style={{ fontSize: 12 }}>
              {ip}
            </div>
          ));
        },
      },
      { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
      { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => statusTag(s) },
      {
        title: '授权策略',
        dataIndex: 'strategies',
        key: 'strategies',
        render: (arr: AppItem['strategies']) => (
          <Space wrap>
            {arr.map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </Space>
        ),
      },
      {
        title: '操作',
        key: 'act',
        render: (_: any, r: AppItem) => {
          const items: any[] = [
            { key: 'edit', label: '编辑', icon: <SettingOutlined /> },
            { key: 'security', label: '安全配置', icon: <SafetyCertificateOutlined /> },
            { key: 'detail', label: '详情', icon: <FileTextOutlined /> },
            { type: 'divider' },
            { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
          ];
          const onClick = ({ key }: any) => {
            if (key === 'edit') {
              setEditingApp(r);
              setCreateOpen(true);
              return;
            }
            if (key === 'security') return openSecurity(r);
            if (key === 'detail') return openDetail(r);
            if (key === 'delete') return removeApp(r.id);
          };
          return (
            <ResourceActionsDropdown
              items={items}
              onClick={onClick}
              buttonType="text"
              buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
            />
          );
        },
      },
    ];

    return (
      <>
        <PageContainer
          hideHeader
          asCard={false}
          pagePadding={0}
          toolbarLeft={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                allowClear
                placeholder="名称/描述"
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                className="toolbar-search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Select
                className="toolbar-filter-sm"
                placeholder="安全域"
                allowClear
                showSearch
                value={domainFilter}
                onChange={(v) => setDomainFilter(v)}
                options={domains.map((d) => ({ value: d.id, label: d.name }))}
              />
              <Select
                className="toolbar-filter-sm"
                placeholder="状态"
                allowClear
                value={statusFilter}
                onChange={(v) => setStatusFilter(v)}
                options={[
                  { value: 'running', label: '运行中' },
                  { value: 'stopped', label: '已停止' },
                  { value: 'degraded', label: '告警' },
                ]}
              />
              <button
                type="button"
                className="toolbar-reset-btn"
                onClick={() => {
                  setKeyword('');
                  setDomainFilter(undefined);
                  setStatusFilter(undefined);
                }}
              >
                重置
              </button>
            </div>
          }
          primaryAction={{
            text: '注册应用',
            onClick: () => setCreateOpen(true),
          }}
          moreMenuItems={[
            {
              key: 'bulkDel',
              label: '批量删除',
              danger: true,
              disabled: selectedRowKeys.length === 0,
              onClick: removeSelectedApps,
            },
          ]}
          onRefresh={loadData}
          tableProps={{
            columns,
            dataSource: filtered,
            rowKey: 'id',
            className: 'vr-table std-table',
            loading,
            rowSelection: {
              selectedRowKeys,
              onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
            },
            pagination: {
              size: 'small',
              showTotal: (total) => `共 ${total} 条`,
            },
            scroll: { x: 'max-content' },
          }}
          defaultHiddenColumns={['strategies', 'version', 'owner']}
        />

        <SecDomainAppWizardModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setEditingApp(undefined);
          }}
          onSuccess={loadData}
          editingApp={editingApp}
        />

        <AppSecurityConfigModal
          open={securityOpen}
          onClose={() => {
            setSecurityOpen(false);
            setCurrentApp(null);
          }}
          app={currentApp}
          policyForm={policyForm}
          aclForm={aclForm}
          policyOptions={policyOptions}
          aclContext={aclContext}
          onSubmitPolicy={submitPolicy}
          onSubmitAcl={submitAcl}
          onNavigateToPolicies={() => navigate('/admin/access/policies')}
        />

        <AppDetailModal
          open={detailOpen}
          app={detailApp}
          onClose={() => {
            setDetailOpen(false);
            setDetailApp(null);
          }}
        />
      </>
    );
  },
);

export default ApplicationListSection;
