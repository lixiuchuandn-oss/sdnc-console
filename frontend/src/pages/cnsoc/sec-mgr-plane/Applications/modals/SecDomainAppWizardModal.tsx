import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  message,
  Modal,
  Row,
  Select,
  Steps,
  Table,
  theme,
  Typography,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import {
  createService,
  fetchAllInstances,
  fetchCloudProviderEcs,
  fetchClouds,
  updateService,
} from '../../../../../services/api';
import { fetchRancherClusterWorkloads, type RancherWorkloadKind } from '../../../../../services/rancherClusterApi';
import { listSecurityDomains } from '../../../../../services/securityDomainApi';
import {
  buildRancherWorkloadInstanceKey,
  filterDomainsForGenericAppWizard,
  getRancherPoolAndCluster,
  isRancherLikeSecurityDomain,
} from '../utils/rancherAppDomainUtils';
import type { ColumnType } from 'antd/es/table';
import type { FilterDropdownProps } from 'antd/es/table/interface';
import type { AppItem } from '../types/app';

// --- constants & layout tokens ---

const MODAL_WIDTH = 860;

/** 右侧步骤内容区最小高度，各步一致，避免切换时忽高忽低 */
const WIZARD_CONTENT_MIN_HEIGHT = 360;

/** 虚拟机 / 容器：含「资源选择」 */
const WIZARD_STEPS_FULL: { title: string }[] = [
  { title: '基本信息' },
  { title: '服务类型' },
  { title: '资源选择' },
  { title: '服务配置' },
];

/** 服务地址：无资源绑定，跳过「资源选择」 */
const WIZARD_STEPS_SERVICE_ADDRESS: { title: string }[] = [
  { title: '基本信息' },
  { title: '服务类型' },
  { title: '服务配置' },
];
const GUTTER = 8;

const ITEM_ZERO_MB: React.CSSProperties = { marginBottom: 0 };
const LIST_ROW_MG: React.CSSProperties = { marginBottom: 8 };
const FIELD_FULL_W: React.CSSProperties = { width: '100%' };
const ACTION_COL: React.CSSProperties = {
  flexShrink: 0,
  width: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** 资源表格区域最大高度 */
const RESOURCE_TABLE_WRAP_STYLE: React.CSSProperties = {
  maxHeight: 'clamp(200px, 32vh, 420px)',
  overflow: 'auto',
};

const L7_PROTOCOL_OPTIONS = ['HTTP', 'HTTPS', 'TCP', 'UDP'] as const;
const L4_PROTOCOL_OPTIONS = ['TCP', 'UDP'] as const;

const WORKLOAD_KIND_OPTIONS: { value: RancherWorkloadKind; label: string }[] = [
  { value: 'deployment', label: 'Deployment' },
  { value: 'statefulset', label: 'StatefulSet' },
  { value: 'daemonset', label: 'DaemonSet' },
  { value: 'cronjob', label: 'CronJob' },
  { value: 'job', label: 'Job' },
  { value: 'pod', label: 'Pod' },
];

const ALLOWED_WORKLOAD_KINDS = new Set(WORKLOAD_KIND_OPTIONS.map((o) => o.value));

// --- types ---

export type RegistrationType = 'vm' | 'service_address' | 'container';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingApp?: AppItem;
  /** 新建时默认选中的注册类型（编辑时忽略） */
  defaultRegistrationType?: RegistrationType;
};

type TransferRow = { key: string; title: string; description: string; tag?: string; ip?: string };

type VmInstanceFieldsProps = {
  transferDataSource: TransferRow[];
  targetKeys: string[];
  onTargetKeysChange: (keys: string[]) => void;
  loading: boolean;
  /** 默认 true；与「配置」分步时仅一侧为 true */
  includePorts?: boolean;
};

// --- pure helpers ---

function parseWorkloadKindFromInstanceKey(key: string): RancherWorkloadKind | null {
  const parts = String(key).split(':');
  if (parts.length < 4 || parts[0] !== 'k8s') return null;
  const k = String(parts[1] || '').toLowerCase() as RancherWorkloadKind;
  return ALLOWED_WORKLOAD_KINDS.has(k) ? k : null;
}

type AppItemWithNetwork = AppItem & { networkConfig?: Record<string, unknown> };

function policyPayloadFromEditing(app: AppItemWithNetwork | undefined) {
  if (!app) {
    return {
      strategies: ['RBAC'] as ('RBAC' | 'ABAC')[],
      policyIds: [] as string[],
      networkPolicyIds: [] as string[],
      hostPolicyIds: [] as string[],
      networkConfig: {
        enableAcl: false,
        allowedSourceCidrs: [] as string[],
        defaultAction: 'permit' as const,
      },
    };
  }
  const raw: string[] = Array.isArray(app.policyIds) ? app.policyIds : [];
  return {
    strategies: Array.isArray(app.strategies) && app.strategies.length ? app.strategies : (['RBAC'] as ('RBAC' | 'ABAC')[]),
    policyIds: raw.filter((p) => !p.startsWith('np-') && !p.startsWith('hp-')),
    networkPolicyIds: raw.filter((p) => p.startsWith('np-')),
    hostPolicyIds: raw.filter((p) => p.startsWith('hp-')),
    networkConfig:
      app.networkConfig && typeof app.networkConfig === 'object'
        ? app.networkConfig
        : {
            enableAcl: raw.some((p) => p.startsWith('np-')),
            allowedSourceCidrs: [] as string[],
            defaultAction: raw.includes('np-default-deny') ? ('deny' as const) : ('permit' as const),
          },
  };
}

/** 表格多选（替代穿梭框） */
function ResourcePickerTable({
  variant,
  rows,
  selectedKeys,
  onSelectionChange,
  loading,
}: {
  variant: 'vm' | 'container';
  rows: TransferRow[];
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  loading?: boolean;
}) {
  const { token } = theme.useToken();

  const columns: ColumnType<TransferRow>[] = useMemo(() => {
    const nameColumnFilter = (placeholder: string, onFilterRow: (value: string, record: TransferRow) => boolean) => ({
      filterDropdown: (filterProps: FilterDropdownProps) => {
        const { setSelectedKeys, selectedKeys, confirm, clearFilters, close } = filterProps;
        return (
          <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
            <Input
              allowClear
              placeholder={placeholder}
              value={(selectedKeys[0] as string) || ''}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedKeys(v ? [v] : []);
              }}
              onPressEnter={() => {
                confirm({ closeDropdown: true });
                close?.();
              }}
              style={{ width: 200, display: 'block' }}
              suffix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  clearFilters?.();
                  confirm({ closeDropdown: true });
                  close?.();
                }}
              >
                重置
              </Button>
              <Button
                type="primary"
                size="small"
                onClick={() => {
                  confirm({ closeDropdown: true });
                  close?.();
                }}
              >
                确定
              </Button>
            </div>
          </div>
        );
      },
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? token.colorPrimary : token.colorTextQuaternary }} />
      ),
      onFilter: (value: boolean | React.Key, record: TransferRow) => {
        if (value == null || value === '') return true;
        return onFilterRow(String(value), record);
      },
    });

    if (variant === 'vm') {
      return [
        {
          title: '虚拟机名称',
          dataIndex: 'title',
          key: 'title',
          ellipsis: true,
          ...nameColumnFilter('搜索名称或 IP', (v, record) => {
            const s = v.toLowerCase();
            if (String(record.title).toLowerCase().includes(s)) return true;
            const ip = String(record.ip ?? record.description ?? '');
            return ip.toLowerCase().includes(s);
          }),
        } as ColumnType<TransferRow>,
        {
          title: 'IP',
          key: 'ip',
          ellipsis: true,
          render: (_: unknown, r: TransferRow) => r.ip ?? r.description ?? '—',
        },
      ];
    }
    return [
      {
        title: '工作负载',
        dataIndex: 'title',
        key: 'title',
        ellipsis: true,
        ...nameColumnFilter('搜索工作负载、说明', (v, record) => {
          const s = v.toLowerCase();
          if (String(record.title).toLowerCase().includes(s)) return true;
          if (String(record.description).toLowerCase().includes(s)) return true;
          return String(record.key).toLowerCase().includes(s);
        }),
      } as ColumnType<TransferRow>,
      { title: '信息', dataIndex: 'description', key: 'description', ellipsis: true },
    ];
  }, [variant, token.colorPrimary, token.colorTextQuaternary]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        margin: 0,
        padding: 0,
      }}
    >
      <div style={RESOURCE_TABLE_WRAP_STYLE}>
        <Table<TransferRow>
          size="small"
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{
            pageSize: 10,
            size: 'small',
            hideOnSinglePage: true,
            showSizeChanger: false,
          }}
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys: selectedKeys,
            preserveSelectedRowKeys: true,
            onChange: (keys) => onSelectionChange(keys.map(String)),
            getCheckboxProps: () => ({ disabled: !!loading }),
          }}
        />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        已选 {selectedKeys.length} 项
      </Typography.Text>
    </div>
  );
}

function mergeCloudmapIntoInstances(
  instances: Record<string, unknown>[],
  cloudmapInstances: Record<string, unknown>[],
  domCid: string,
): Record<string, unknown>[] {
  const allCandidates = [...instances];
  cloudmapInstances.forEach((ci) => {
    const k = String((ci as { id?: string }).id);
    const idx = allCandidates.findIndex((i) => String((i as { id?: string }).id) === k);
    if (idx < 0) {
      allCandidates.push(ci);
      return;
    }
    const cur = allCandidates[idx];
    const cCloud = String((ci as { cloudId?: string }).cloudId || '').trim();
    const eCloud = String((cur as { cloudId?: string }).cloudId || '').trim();
    if (domCid && cCloud === domCid && eCloud !== domCid) {
      allCandidates[idx] = ci;
    }
  });
  return allCandidates;
}

// --- field groups (协议 / 端口置于 Card 内) ---

function ServiceAddressFields() {
  const { token } = theme.useToken();
  return (
    <Form.Item label="服务地址（协议 / IP / 端口）" style={{ marginBottom: token.marginLG }}>
      <div>
      <Form.List name="serviceAddresses">
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...rest }) => (
              <Row key={key} gutter={GUTTER} style={LIST_ROW_MG} align="middle" wrap={false}>
                <Col flex="1" style={{ minWidth: 0 }}>
                  <Form.Item
                    {...rest}
                    name={[name, 'protocol']}
                    rules={[{ required: true, message: '请选择' }]}
                    style={ITEM_ZERO_MB}
                  >
                    <Select
                      placeholder="协议"
                      style={FIELD_FULL_W}
                      options={L7_PROTOCOL_OPTIONS.map((v) => ({ label: v, value: v }))}
                    />
                  </Form.Item>
                </Col>
                <Col flex="2" style={{ minWidth: 0 }}>
                  <Form.Item
                    {...rest}
                    name={[name, 'ip']}
                    rules={[{ required: true, message: 'IP' }]}
                    style={ITEM_ZERO_MB}
                  >
                    <Input placeholder="IP" style={FIELD_FULL_W} />
                  </Form.Item>
                </Col>
                <Col flex="1" style={{ minWidth: 0 }}>
                  <Form.Item
                    {...rest}
                    name={[name, 'port']}
                    rules={[{ required: true, message: '端口' }]}
                    style={ITEM_ZERO_MB}
                  >
                    <Input placeholder="端口" style={FIELD_FULL_W} />
                  </Form.Item>
                </Col>
                <Col style={ACTION_COL}>
                  <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                </Col>
              </Row>
            ))}
            <Form.Item style={ITEM_ZERO_MB}>
              <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                添加地址
              </Button>
            </Form.Item>
          </>
        )}
      </Form.List>
      </div>
    </Form.Item>
  );
}

function ServicePortsFields() {
  const { token } = theme.useToken();
  return (
    <Form.Item label="协议与端口" style={{ marginBottom: token.marginLG }}>
      <div>
      <Form.List name="servicePorts">
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...rest }) => (
              <Row key={key} gutter={GUTTER} style={LIST_ROW_MG} align="middle" wrap={false}>
                <Col flex="1" style={{ minWidth: 0 }}>
                  <Form.Item
                    {...rest}
                    name={[name, 'protocol']}
                    rules={[{ required: true, message: '必填' }]}
                    style={ITEM_ZERO_MB}
                  >
                    <Select
                      placeholder="协议"
                      style={FIELD_FULL_W}
                      options={L4_PROTOCOL_OPTIONS.map((v) => ({ label: v, value: v }))}
                    />
                  </Form.Item>
                </Col>
                <Col flex="1" style={{ minWidth: 0 }}>
                  <Form.Item
                    {...rest}
                    name={[name, 'port']}
                    rules={[{ required: true, message: '必填' }]}
                    style={ITEM_ZERO_MB}
                  >
                    <Input placeholder="端口" style={FIELD_FULL_W} />
                  </Form.Item>
                </Col>
                <Col style={ACTION_COL}>
                  <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                </Col>
              </Row>
            ))}
            <Form.Item style={ITEM_ZERO_MB}>
              <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                添加端口
              </Button>
            </Form.Item>
          </>
        )}
      </Form.List>
      </div>
    </Form.Item>
  );
}

function VmInstanceFields({
  transferDataSource,
  targetKeys,
  onTargetKeysChange,
  loading,
  includePorts = true,
}: VmInstanceFieldsProps) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        marginBottom: includePorts ? token.marginLG : 0,
        display: 'flex',
        flexDirection: 'column',
        rowGap: token.margin,
      }}
    >
      <ResourcePickerTable
        variant="vm"
        rows={transferDataSource}
        selectedKeys={targetKeys}
        onSelectionChange={onTargetKeysChange}
        loading={loading}
      />
      {includePorts ? <ServicePortsFields /> : null}
    </div>
  );
}

// --- main modal ---

const SecDomainAppWizardModal: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  editingApp,
  defaultRegistrationType,
}) => {
  const [loading, setLoading] = useState(false);
  const [domainLoading, setDomainLoading] = useState(false);
  const [instances, setInstances] = useState<Record<string, unknown>[]>([]);
  const [cloudmapInstances, setCloudmapInstances] = useState<Record<string, unknown>[]>([]);
  const [domains, setDomains] = useState<Record<string, unknown>[]>([]);
  const [clouds, setClouds] = useState<Record<string, unknown>[]>([]);
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [workloads, setWorkloads] = useState<Record<string, unknown>[]>([]);
  const [workloadsLoading, setWorkloadsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const [form] = Form.useForm();
  const selectedDomainId = Form.useWatch('domainId', form);
  const selectedType = (Form.useWatch('type', form) || form.getFieldValue('type') || 'vm') as AppItem['type'];
  const workloadKindWatch = (Form.useWatch('workloadKind', form) || 'deployment') as RancherWorkloadKind;

  const { token } = theme.useToken();

  const wizardStepItems = useMemo(
    () => (selectedType === 'service_address' ? WIZARD_STEPS_SERVICE_ADDRESS : WIZARD_STEPS_FULL),
    [selectedType],
  );

  const loadClouds = async () => {
    try {
      const res: unknown = await fetchClouds();
      const list = Array.isArray(res) ? res : (Array.isArray((res as { data?: unknown })?.data) ? (res as { data: unknown[] }).data : []);
      setClouds(list as Record<string, unknown>[]);
    } catch (e) {
      console.error(e);
    }
  };

  const loadInstances = async () => {
    try {
      setLoading(true);
      const res = (await fetchAllInstances()) as { data?: unknown[] };
      const list = Array.isArray(res?.data) ? res.data : [];
      setInstances(list as Record<string, unknown>[]);
    } catch (e) {
      console.error(e);
      message.error('加载资源列表失败');
    } finally {
      setLoading(false);
    }
  };

  const rancherDomains = useMemo(
    () =>
      (Array.isArray(domains) ? domains : []).filter((d) => {
        if (!isRancherLikeSecurityDomain(d)) return false;
        return getRancherPoolAndCluster(d) != null;
      }),
    [domains],
  );

  const loadDomains = async () => {
    try {
      setDomainLoading(true);
      const list = await listSecurityDomains();
      const domainList = Array.isArray(list) ? list : [];
      setDomains(domainList as Record<string, unknown>[]);

      const typeNow = form.getFieldValue('type') || 'vm';
      const currentDomainId = form.getFieldValue('domainId');

      if (editingApp) {
        const typeEdit = editingApp.type || 'vm';
        let candidates: Record<string, unknown>[] = domainList as Record<string, unknown>[];
        if (typeEdit === 'container') {
          candidates = domainList.filter((d) => isRancherLikeSecurityDomain(d) && getRancherPoolAndCluster(d) != null) as Record<
            string,
            unknown
          >[];
        } else if (typeEdit === 'vm') {
          candidates = filterDomainsForGenericAppWizard(domainList, editingApp) as Record<string, unknown>[];
        }
        if (candidates.length > 0 && !currentDomainId) {
          form.setFieldsValue({ domainId: (candidates[0] as { id?: string }).id });
        }
      } else if (typeNow === 'container') {
        const rd = domainList.filter((d) => isRancherLikeSecurityDomain(d) && getRancherPoolAndCluster(d) != null);
        if (rd.length > 0 && !currentDomainId) {
          form.setFieldsValue({ domainId: (rd[0] as { id?: string }).id });
        }
      } else if (typeNow === 'service_address') {
        if (domainList.length > 0 && !currentDomainId) {
          form.setFieldsValue({ domainId: (domainList[0] as { id?: string }).id });
        }
      } else {
        const forWizard = filterDomainsForGenericAppWizard(domainList, undefined);
        if (forWizard.length > 0 && !currentDomainId) {
          form.setFieldsValue({ domainId: (forWizard[0] as { id?: string }).id });
        }
      }
    } catch (e) {
      console.error(e);
      message.error('加载安全域失败');
    } finally {
      setDomainLoading(false);
    }
  };

  const domainOptionsForWizard = useMemo(() => {
    const t = selectedType || 'vm';
    if (t === 'container') {
      return rancherDomains.map((d) => ({ label: (d as { name?: string; id?: string }).name || (d as { id?: string }).id, value: (d as { id?: string }).id }));
    }
    if (t === 'service_address') {
      return (Array.isArray(domains) ? domains : []).map((d) => ({
        label: (d as { name?: string; id?: string }).name || (d as { id?: string }).id,
        value: (d as { id?: string }).id,
      }));
    }
    return filterDomainsForGenericAppWizard(domains, editingApp).map((d) => ({
      label: (d as { name?: string; id?: string }).name || (d as { id?: string }).id,
      value: (d as { id?: string }).id,
    }));
  }, [domains, editingApp, selectedType, rancherDomains]);

  const currentDomain = useMemo(() => {
    const id = selectedDomainId ?? form.getFieldValue('domainId');
    return domains.find((d) => String((d as { id?: string }).id) === String(id));
  }, [domains, selectedDomainId, form]);

  const rancherCtx = useMemo(
    () => (selectedType === 'container' && currentDomain ? getRancherPoolAndCluster(currentDomain) : null),
    [selectedType, currentDomain],
  );

  const vrIdsInDomain: string[] = useMemo(() => {
    const raw = (currentDomain as { vrInstanceIds?: unknown } | undefined)?.vrInstanceIds;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [currentDomain]);

  const vmTransferDataSource = useMemo(() => {
    const vpcId = (currentDomain as { vpcId?: string } | undefined)?.vpcId;
    const vpcStr = vpcId ? String(vpcId) : '';
    const domCid =
      (currentDomain as { cloudId?: string | number } | undefined)?.cloudId != null
        ? String((currentDomain as { cloudId?: string | number }).cloudId).trim()
        : '';
    const allCandidates = mergeCloudmapIntoInstances(instances, cloudmapInstances, domCid);
    const filteredInstances = allCandidates
      .filter((i) => {
        const row = i as { vpcId?: string; extra?: { vpcId?: string; vpc_id?: string } };
        const ivpc = String(row.vpcId || (row.extra && (row.extra.vpcId || row.extra.vpc_id)) || '');
        return vpcStr ? ivpc === vpcStr : true;
      })
      .filter((i) => !vrIdsInDomain.includes(String((i as { id?: string }).id)));
    return filteredInstances.map((i) => {
      const row = i as {
        id?: string;
        name?: string;
        provider?: string;
        region?: string;
        privateIps?: string[];
      };
      const ipStr = (row.privateIps || []).filter(Boolean).join(', ') || '—';
      return {
        key: String(row.id),
        title: row.name != null ? String(row.name) : String(row.id),
        ip: ipStr,
        description: ipStr,
      };
    });
  }, [instances, cloudmapInstances, currentDomain, vrIdsInDomain]);

  const containerTransferData = useMemo(() => {
    const kind = workloadKindWatch;
    return workloads.map((row) => {
      const r = row as { namespace?: string; name?: string; ready?: unknown; status?: unknown };
      const ns = String(r.namespace || '').trim();
      const name = String(r.name || '').trim() || '—';
      const key = buildRancherWorkloadInstanceKey(kind, ns, name);
      return {
        key,
        title: name,
        description: [ns, r.ready, r.status]
          .filter((x) => x !== undefined && x !== null && String(x).trim() !== '')
          .map(String)
          .join(' · '),
      };
    });
  }, [workloads, workloadKindWatch]);

  useEffect(() => {
    if (open) setCurrentStep(0);
  }, [open]);

  useEffect(() => {
    if (selectedType === 'service_address' && currentStep > 2) {
      setCurrentStep(2);
    }
  }, [selectedType, currentStep]);

  useEffect(() => {
    if (!open) return;
    void loadClouds();
    if (editingApp) {
      if (editingApp.type === 'service_address') {
        form.setFieldsValue({
          name: editingApp.name,
          version: editingApp.version,
          owner: editingApp.owner,
          domainId: editingApp.domainId,
          type: editingApp.type,
          description: editingApp.description,
          serviceAddresses: editingApp.serviceAddresses || [],
        });
        setTargetKeys([]);
      } else if (editingApp.type === 'container') {
        const keys = (editingApp.instances || []).map((k) => String(k));
        const kindFromKey = keys.length ? parseWorkloadKindFromInstanceKey(keys[0]) : null;
        form.setFieldsValue({
          name: editingApp.name,
          version: editingApp.version,
          owner: editingApp.owner,
          domainId: editingApp.domainId,
          type: 'container',
          description: editingApp.description,
          workloadKind: kindFromKey || 'deployment',
          servicePorts:
            Array.isArray(editingApp.servicePorts) && editingApp.servicePorts.length
              ? editingApp.servicePorts
              : [{ protocol: 'TCP', port: '443' }],
        });
        setTargetKeys(keys);
      } else {
        form.setFieldsValue({
          name: editingApp.name,
          version: editingApp.version,
          owner: editingApp.owner,
          domainId: editingApp.domainId,
          type: editingApp.type,
          description: editingApp.description,
          servicePorts: editingApp.servicePorts || [],
        });
        setTargetKeys((editingApp.instances || []).map((k) => String(k)));
      }
    } else {
      form.resetFields();
      const t = defaultRegistrationType || 'vm';
      form.setFieldsValue({
        type: t,
        workloadKind: 'deployment',
        ...(t === 'container' ? { servicePorts: [{ protocol: 'TCP', port: '443' }] } : {}),
      });
      setTargetKeys([]);
    }
    void loadInstances();
    void loadDomains();
  }, [open, editingApp, form, defaultRegistrationType]);

  useEffect(() => {
    if (selectedType !== 'vm') {
      setCloudmapInstances([]);
      return;
    }
    const fetchCloudmapResources = async () => {
      setCloudmapInstances([]);
      if (!currentDomain) return;
      const cid = (currentDomain as { cloudId?: string }).cloudId;
      if (!cid) return;
      const cloud = clouds.find((c) => String((c as { id?: string; _id?: string; uuid?: string }).id || (c as { _id?: string })._id || (c as { uuid?: string }).uuid) === String(cid));
      const provider = String((cloud as { config?: { provider?: string }; type?: string } | undefined)?.config?.provider || (cloud as { type?: string } | undefined)?.type || '').toLowerCase();
      if (provider === 'harvester' || provider.includes('cloudmap')) {
        try {
          setLoading(true);
          const ecsJson = (await fetchCloudProviderEcs(cid)) as { data?: unknown };
          const data = ecsJson?.data ?? ecsJson;
          const ecsList = Array.isArray(data) ? data : (Array.isArray((data as { data?: unknown[] })?.data) ? (data as { data: unknown[] }).data : []);
          const mapped = ecsList
            .map((x: Record<string, unknown>) => ({
              id: String(x?.InstanceId || x?.id || x?.uuid || ''),
              cloudId: String(cid),
              name: x?.InstanceName || x?.name || x?.id,
              provider,
              region: (cloud as { region?: string } | undefined)?.region || '',
              privateIps: x?.PrivateIpAddress
                ? [x.PrivateIpAddress as string]
                : (Array.isArray(x?.fixed_ips) ? (x.fixed_ips as { ip_address?: string }[]).map((ip) => ip.ip_address) : []),
              vpcId: x?.VpcId || x?.vpcId || x?.vpc_id || '',
              status: (x?.State as { Name?: string } | undefined)?.Name || x?.status || 'unknown',
              extra: x,
            }))
            .filter((x) => !!x.id);
          setCloudmapInstances(mapped as Record<string, unknown>[]);
        } catch (e) {
          console.error(e);
          setCloudmapInstances([]);
        } finally {
          setLoading(false);
        }
      }
    };
    void fetchCloudmapResources();
  }, [selectedType, currentDomain, clouds]);

  useEffect(() => {
    if (!open || selectedType !== 'container') {
      setWorkloads([]);
      return;
    }
    if (!rancherCtx) {
      setWorkloads([]);
      if (!domainLoading && domains.length > 0) {
        setTargetKeys([]);
      }
      return;
    }
    let cancel = false;
    void (async () => {
      setWorkloadsLoading(true);
      try {
        const list = await fetchRancherClusterWorkloads(rancherCtx.poolId, rancherCtx.clusterId, workloadKindWatch);
        if (!cancel) setWorkloads(Array.isArray(list) ? (list as Record<string, unknown>[]) : []);
      } catch {
        if (!cancel) {
          setWorkloads([]);
          message.error('加载工作负载失败');
        }
      } finally {
        if (!cancel) setWorkloadsLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, selectedType, rancherCtx?.poolId, rancherCtx?.clusterId, workloadKindWatch, domainLoading, domains.length]);

  useEffect(() => {
    if (selectedDomainId === undefined || selectedDomainId === null) return;
    if (editingApp && String(editingApp.domainId) === String(selectedDomainId)) return;
    setTargetKeys([]);
    form.setFieldsValue({ instances: [] });
  }, [selectedDomainId, editingApp, form]);

  useEffect(() => {
    if (!open) return;
    if (domainLoading) return;
    const t = selectedType || 'vm';
    const dataLoading = t === 'container' ? workloadsLoading : loading;
    if (dataLoading) return;
    const rows = t === 'container' ? containerTransferData : vmTransferDataSource;
    const valid = new Set(rows.map((d) => String(d.key)));
    setTargetKeys((prev) => {
      if (!prev.length) return prev;
      if (valid.size > 0) {
        const next = prev.map((k) => String(k)).filter((k) => valid.has(k));
        if (next.length === prev.length) return prev;
        form.setFieldsValue({ instances: next });
        return next;
      }
      if (editingApp) return prev;
      form.setFieldsValue({ instances: [] });
      return [];
    });
  }, [
    open,
    vmTransferDataSource,
    containerTransferData,
    form,
    domainLoading,
    loading,
    workloadsLoading,
    editingApp,
    selectedType,
  ]);

  useEffect(() => {
    if (!open || domainLoading) return;
    const cur = form.getFieldValue('domainId');
    if (cur == null || cur === '') return;
    const ok = domainOptionsForWizard.some((o) => String(o.value) === String(cur));
    if (!ok) {
      const next = domainOptionsForWizard[0]?.value;
      form.setFieldsValue({ domainId: next });
      setTargetKeys([]);
    }
  }, [open, domainLoading, domainOptionsForWizard, form]);

  const handleSubmit = async () => {
    const resourceType = (form.getFieldValue('type') || 'vm') as string;
    const submitLoading = resourceType === 'container' ? workloadsLoading : loading;
    if (submitLoading) {
      message.info(resourceType === 'container' ? '工作负载加载中' : '资源加载中');
      return;
    }

    setLoading(true);
    try {
      await form.validateFields();

      const basic = form.getFieldsValue();
      const dom = domains.find((d) => String((d as { id?: string }).id) === String(basic.domainId));
      const domainName = (dom as { name?: string } | undefined)?.name || undefined;

      const policyBlock = policyPayloadFromEditing(editingApp);

      const payload: Record<string, unknown> = {
        ...basic,
        domainName,
        ...policyBlock,
        status: 'running',
        type: resourceType,
      };

      if (resourceType === 'service_address') {
        const resourceValues = form.getFieldsValue();
        const serviceAddresses = Array.isArray(resourceValues.serviceAddresses)
          ? resourceValues.serviceAddresses.filter((x: { protocol?: string; ip?: string; port?: string }) => x && x.protocol && x.ip && x.port)
          : [];
        if (!serviceAddresses.length) {
          message.error('请至少配置一个服务地址');
          return;
        }
        payload.serviceAddresses = serviceAddresses;
      } else if (resourceType === 'container') {
        const ctx = dom ? getRancherPoolAndCluster(dom) : null;
        if (!ctx || !dom) {
          message.error('安全域无效或未配置 Rancher 集群');
          return;
        }
        if (!workloads.length) {
          message.error('无工作负载可选择');
          return;
        }
        if (targetKeys.length < 1) {
          message.error('请选择至少一个工作负载');
          return;
        }
        const resourceValues = form.getFieldsValue();
        const servicePorts = Array.isArray(resourceValues.servicePorts)
          ? resourceValues.servicePorts.filter((x: { protocol?: string; port?: string }) => x && x.protocol && String(x?.port).trim())
          : [];
        if (!servicePorts.length) {
          message.error('请至少配置一个服务端口');
          return;
        }
        payload.type = 'container';
        payload.servicePorts = servicePorts.map((x: { protocol?: string; port?: string }) => ({
          protocol: x.protocol,
          port: String(x.port).trim(),
        }));
        payload.instances = targetKeys.map((k) => String(k));
        payload.instanceIps = [];
        payload.instanceCount = targetKeys.length;
      } else {
        if (targetKeys.length < 1) {
          message.error('请选择至少一个实例');
          return;
        }
        const resourceValues = form.getFieldsValue();
        const servicePorts = Array.isArray(resourceValues.servicePorts)
          ? resourceValues.servicePorts.filter((x: { protocol?: string; port?: string }) => x && x.protocol && x.port)
          : [];
        if (!servicePorts.length) {
          message.error('请至少配置一个服务端口');
          return;
        }
        payload.servicePorts = servicePorts;
        const keySet = new Set(targetKeys.map((k) => String(k)));
        const vpcId = (currentDomain as { vpcId?: string } | undefined)?.vpcId;
        const vpcStr = vpcId ? String(vpcId) : '';
        const domCid =
          (currentDomain as { cloudId?: string | number } | undefined)?.cloudId != null
            ? String((currentDomain as { cloudId?: string | number }).cloudId).trim()
            : '';
        const allCandidates = mergeCloudmapIntoInstances(instances, cloudmapInstances, domCid);
        const filteredInstances = allCandidates
          .filter((i) => {
            const row = i as { vpcId?: string; extra?: { vpcId?: string; vpc_id?: string } };
            const ivpc = String(row.vpcId || (row.extra && (row.extra.vpcId || row.extra.vpc_id)) || '');
            return vpcStr ? ivpc === vpcStr : true;
          })
          .filter((i) => !vrIdsInDomain.includes(String((i as { id?: string }).id)));
        const selectedRows = filteredInstances.filter((i) => keySet.has(String((i as { id?: string }).id)));
        const instanceIps = selectedRows
          .flatMap((i) => (Array.isArray((i as { privateIps?: string[] }).privateIps) ? (i as { privateIps: string[] }).privateIps : []))
          .filter(Boolean);
        payload.instanceIps = instanceIps;
        payload.instances = targetKeys.map((k) => String(k));
        payload.instanceCount = targetKeys.length;
      }

      delete payload.workloadKind;

      if (editingApp?.id) {
        await updateService(editingApp.id, payload);
        message.success('已更新');
      } else {
        await createService(payload);
        message.success('已创建');
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { errorFields?: unknown; message?: string };
      if (err?.errorFields) return;
      message.error(err?.message || (editingApp ? '更新失败' : '创建失败'));
    } finally {
      setLoading(false);
    }
  };

  const primaryBusy = selectedType === 'container' ? workloadsLoading || loading : loading;
  const lastStepIndex = wizardStepItems.length - 1;

  const goNext = async () => {
    try {
      if (currentStep === 0) {
        await form.validateFields(['name']);
      } else if (currentStep === 1) {
        const t = (form.getFieldValue('type') || 'vm') as AppItem['type'];
        if (t === 'container') {
          await form.validateFields(['type', 'domainId', 'workloadKind']);
        } else {
          await form.validateFields(['type', 'domainId']);
        }
      } else if (currentStep === 2) {
        const t = (form.getFieldValue('type') || 'vm') as AppItem['type'];
        if (t === 'service_address') {
          return;
        }
        if (t === 'vm') {
          if (loading) {
            message.info('资源加载中');
            return;
          }
          if (targetKeys.length < 1) {
            message.error('请至少选择一个实例');
            return;
          }
        } else if (t === 'container') {
          if (workloadsLoading) {
            message.info('工作负载加载中');
            return;
          }
          if (!workloads.length) {
            message.error('无工作负载可选择');
            return;
          }
          if (targetKeys.length < 1) {
            message.error('请选择至少一个工作负载');
            return;
          }
        }
      } else {
        return;
      }
      setCurrentStep((s) => Math.min(s + 1, lastStepIndex));
    } catch {
      // validateFields 已高亮
    }
  };

  return (
    <Modal
      title="注册应用"
      open={open}
      centered
      onCancel={onClose}
      width={MODAL_WIDTH}
      destroyOnHidden
      footer={null}
      styles={{ body: { maxHeight: '80vh', overflowX: 'hidden', overflowY: 'auto' } }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'vm', workloadKind: 'deployment' }}
        onValuesChange={(changed) => {
          if (Object.prototype.hasOwnProperty.call(changed, 'type')) {
            const nt = changed.type as AppItem['type'];
            setTargetKeys([]);
            form.setFieldsValue({ instances: [] });
            if (nt === 'container') {
              form.setFieldsValue({
                workloadKind: 'deployment',
                servicePorts: [{ protocol: 'TCP', port: '443' }],
              });
            }
          }
          if (Object.prototype.hasOwnProperty.call(changed, 'workloadKind')) {
            setTargetKeys([]);
          }
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: token.marginMD,
            alignItems: 'flex-start',
            minHeight: WIZARD_CONTENT_MIN_HEIGHT,
          }}
        >
          <div style={{ width: 148, flexShrink: 0 }}>
            <Steps direction="vertical" size="small" current={currentStep} items={wizardStepItems} />
          </div>
          <div style={{ flex: 1, minWidth: 0, minHeight: WIZARD_CONTENT_MIN_HEIGHT }}>
            <div style={{ display: currentStep === 0 ? 'block' : 'none' }}>
              <Form.Item name="name" label="应用名称" rules={[{ required: true, message: '请输入应用名称' }]}>
                <Input placeholder="请输入应用名称" allowClear />
              </Form.Item>
              <Form.Item name="version" label="版本">
                <Input placeholder="可选" allowClear />
              </Form.Item>
              <Form.Item name="owner" label="负责人">
                <Input placeholder="可选" allowClear />
              </Form.Item>
              <Form.Item name="description" label="描述">
                <Input placeholder="可选" allowClear />
              </Form.Item>
            </div>

            <div style={{ display: currentStep === 1 ? 'block' : 'none' }}>
              <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
                <Select
                  placeholder="请选择类型"
                  disabled={!!editingApp}
                  options={[
                    { label: '虚拟机', value: 'vm' },
                    { label: '容器', value: 'container' },
                    { label: '服务地址', value: 'service_address' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="domainId" label="安全域" rules={[{ required: true, message: '请选择安全域' }]}>
                <Select
                  placeholder="请选择安全域"
                  optionFilterProp="label"
                  loading={domainLoading}
                  options={domainOptionsForWizard}
                />
              </Form.Item>
              {selectedType === 'container' && (
                <Form.Item name="workloadKind" label="工作负载类型" rules={[{ required: true, message: '请选择工作负载类型' }]}>
                  <Select
                    placeholder="请选择工作负载类型"
                    options={WORKLOAD_KIND_OPTIONS}
                    disabled={!!editingApp}
                  />
                </Form.Item>
              )}
            </div>

            <div
              style={{
                display: currentStep === 2 && (selectedType === 'vm' || selectedType === 'container') ? 'block' : 'none',
              }}
            >
              {selectedType === 'vm' &&
                currentDomain &&
                !domainLoading &&
                !loading &&
                vmTransferDataSource.length === 0 && (
                  <Alert
                    type="info"
                    showIcon
                    message="待选侧暂无实例"
                    description="请确认安全域已关联云与网络(VPC)配置正确，且资源已同步到平台。"
                    style={{ marginBottom: token.marginSM }}
                  />
                )}

              <Form.Item name="instances" noStyle>
                <Input type="hidden" />
              </Form.Item>

              {selectedType === 'container' && (
                <ResourcePickerTable
                  variant="container"
                  rows={containerTransferData}
                  selectedKeys={targetKeys}
                  onSelectionChange={(next) => {
                    setTargetKeys(next);
                    form.setFieldsValue({ instances: next });
                  }}
                  loading={workloadsLoading}
                />
              )}

              {selectedType === 'vm' && (
                <VmInstanceFields
                  transferDataSource={vmTransferDataSource}
                  targetKeys={targetKeys}
                  onTargetKeysChange={(next) => {
                    setTargetKeys(next);
                    form.setFieldsValue({ instances: next });
                  }}
                  loading={loading}
                  includePorts={false}
                />
              )}
            </div>

            <div
              style={{
                display:
                  (currentStep === 2 && selectedType === 'service_address') ||
                  (currentStep === 3 && (selectedType === 'vm' || selectedType === 'container'))
                    ? 'block'
                    : 'none',
              }}
            >
              {selectedType === 'service_address' ? (
                <ServiceAddressFields />
              ) : (
                <ServicePortsFields />
              )}
            </div>
          </div>
        </div>
      </Form>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
          第 {currentStep + 1} / {wizardStepItems.length} 步
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <Button onClick={onClose}>取消</Button>
          {currentStep > 0 && <Button onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}>上一步</Button>}
          {currentStep < lastStepIndex && (
            <Button type="primary" onClick={goNext}>
              下一步
            </Button>
          )}
          {currentStep === lastStepIndex && (
            <Button type="primary" loading={primaryBusy} onClick={handleSubmit}>
              {editingApp ? '保存' : '创建'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SecDomainAppWizardModal;
