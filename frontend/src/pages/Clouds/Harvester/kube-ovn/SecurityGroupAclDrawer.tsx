import React, { useEffect, useMemo, useState } from 'react';
import type { DrawerProps } from 'antd/es/drawer';
import type { FormInstance } from 'antd/es/form/Form';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CloseOutlined,
  ExportOutlined,
  ImportOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SafetyOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { SubnetAclFormRow } from './SubnetAclFormItems';

const { Text } = Typography;

export type SgAclDirection = 'inbound' | 'outbound' | 'members';

export type SgMemberRow = {
  id: string;
  vmNamespace: string;
  vmName: string;
  vmAlias: string;
  vmIp: string;
};

export type SgVmOptionRow = {
  value: string;
  vmNamespace: string;
  vmName: string;
  alias: string;
  vmIp: string;
};

export type SecurityGroupAccessControlDrawerProps = {
  AntDrawer: React.ComponentType<DrawerProps>;
  open: boolean;
  onClose: () => void;
  target: { name: string; subnetName: string; subnetDisplayLabel?: string } | null;
  /** 规则 + 成员并行加载 */
  loading: boolean;
  saving: boolean;
  onSave: () => void;
  form: FormInstance;
  readOnly: boolean;
  tab: SgAclDirection;
  onTabChange: (t: SgAclDirection) => void;
  /** 非「关联云主机」Tab 时 Segmented 上展示的成员数 */
  serverMemberCount: number;
  memberKeys: string[];
  onMemberKeysChange: (keys: string[]) => void;
  members: { list: SgMemberRow[]; vmOptions: SgVmOptionRow[] };
};

const SG_ACTION_OPTIONS = [
  { label: '允许', value: 'allow' },
  { label: '拒绝', value: 'drop' },
  { label: '通行(pass)', value: 'pass' },
];

const SG_L4_OPTIONS = [
  { label: '全部', value: 'ip4' },
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
];

const itemNoMargin = { marginBottom: 0 };
const hide = { display: 'none' as const };
const show = { display: 'block' as const };

type Variant = 'inbound' | 'outbound';

const SecurityGroupAclRuleRow: React.FC<{
  restField: Record<string, unknown>;
  listIndex: number;
  variant: Variant;
  onRemove: () => void;
}> = ({ restField, listIndex, onRemove, variant }) => {
  const isInbound = variant === 'inbound';

  return (
    <div style={{ width: '100%', overflowX: 'auto', marginBottom: 12 }}>
      <Row wrap={false} align="top" gutter={[10, 8]} style={{ minWidth: 720, width: '100%' }}>
        <Col flex="88px" style={{ minWidth: 88 }}>
          <Form.Item
            {...restField}
            name={[listIndex, 'priority']}
            rules={[{ required: true, message: '优先级' }]}
            style={itemNoMargin}
          >
            <InputNumber size="middle" min={1} max={32767} placeholder="优先级" style={{ width: '100%' }} controls />
          </Form.Item>
        </Col>
        <Col flex="100px" style={{ minWidth: 100 }}>
          <Form.Item
            {...restField}
            name={[listIndex, 'action']}
            rules={[{ required: true, message: '策略' }]}
            style={itemNoMargin}
          >
            <Select size="middle" placeholder="策略" options={SG_ACTION_OPTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col flex="100px" style={{ minWidth: 100 }}>
          <Form.Item {...restField} name={[listIndex, 'matchL4']} style={itemNoMargin}>
            <Select size="middle" placeholder="协议" options={SG_L4_OPTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>

        {isInbound ? (
          <Col flex="1 1 160px" style={{ minWidth: 140 }}>
            <Form.Item {...restField} name={[listIndex, 'matchSrcIp']} style={itemNoMargin}>
              <Input size="middle" placeholder="源：CIDR 或 IP，如 0.0.0.0/0" allowClear />
            </Form.Item>
          </Col>
        ) : (
          <Col flex="1 1 160px" style={{ minWidth: 140 }}>
            <Form.Item {...restField} name={[listIndex, 'matchDstIp']} style={itemNoMargin}>
              <Input size="middle" placeholder="目的：CIDR 或 IP，如 0.0.0.0/0" allowClear />
            </Form.Item>
          </Col>
        )}

        <Col flex="88px" style={{ minWidth: 88 }}>
          <Form.Item {...restField} name={[listIndex, 'matchSrcPort']} style={itemNoMargin}>
            <InputNumber
              size="middle"
              min={0}
              max={65535}
              placeholder="源端口"
              style={{ width: '100%' }}
              controls={false}
            />
          </Form.Item>
        </Col>
        <Col flex="88px" style={{ minWidth: 88 }}>
          <Form.Item {...restField} name={[listIndex, 'matchDstPort']} style={itemNoMargin}>
            <InputNumber
              size="middle"
              min={0}
              max={65535}
              placeholder="目的端口"
              style={{ width: '100%' }}
              controls={false}
            />
          </Form.Item>
        </Col>

        {isInbound ? (
          <Form.Item {...restField} name={[listIndex, 'matchDstIp']} hidden>
            <Input />
          </Form.Item>
        ) : (
          <Form.Item {...restField} name={[listIndex, 'matchSrcIp']} hidden>
            <Input />
          </Form.Item>
        )}

        <Col flex="none" style={{ flexShrink: 0, paddingTop: 4 }}>
          <MinusCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} onClick={onRemove} />
        </Col>
      </Row>
    </div>
  );
};

const DirectionColumnHeaders: React.FC<{ variant: Variant }> = ({ variant }) => {
  const isInbound = variant === 'inbound';
  return (
    <Row
      wrap={false}
      gutter={[10, 8]}
      style={{
        marginBottom: 4,
        paddingBottom: 6,
        borderBottom: '1px solid var(--ant-color-split)',
        color: 'var(--ant-color-text-secondary)',
        fontSize: 12,
      }}
    >
      <Col flex="88px" style={{ minWidth: 88 }}>
        优先级
      </Col>
      <Col flex="100px" style={{ minWidth: 100 }}>
        策略
      </Col>
      <Col flex="100px" style={{ minWidth: 100 }}>
        协议
      </Col>
      <Col flex="1 1 160px" style={{ minWidth: 140 }}>
        {isInbound ? '访问来源' : '访问目的'}
      </Col>
      <Col flex="88px" style={{ minWidth: 88 }}>
        源端口
      </Col>
      <Col flex="88px" style={{ minWidth: 88 }}>
        目的端口
      </Col>
      <Col flex="none" style={{ width: 24 }} />
    </Row>
  );
};

function defaultRowPartial(variant: Variant): SubnetAclFormRow {
  const base: SubnetAclFormRow = {
    action: 'allow',
    priority: 100,
    matchL4: 'tcp',
    matchSrcIp: '',
    matchDstIp: '',
    matchSrcPort: null,
    matchDstPort: null,
  };
  if (variant === 'inbound') {
    return { ...base, matchSrcIp: '0.0.0.0/0', matchDstIp: '' };
  }
  return { ...base, matchSrcIp: '', matchDstIp: '0.0.0.0/0' };
}

const DirectionRuleBlock: React.FC<{
  listName: 'inboundRules' | 'outboundRules';
  variant: Variant;
}> = ({ listName, variant }) => (
  <div>
    <DirectionColumnHeaders variant={variant} />
    <Form.List name={listName}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...restField }) => (
            <SecurityGroupAclRuleRow
              key={key}
              restField={restField}
              listIndex={name}
              variant={variant}
              onRemove={() => remove(name)}
            />
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add(defaultRowPartial(variant))}>
            添加规则
          </Button>
        </>
      )}
    </Form.List>
  </div>
);

type VmRow = { key: string; alias: string; vmName: string; vmIp: string };

function buildAllVmRows(list: SgMemberRow[], vmOptions: SgVmOptionRow[]): VmRow[] {
  const map = new Map<string, VmRow>();
  for (const row of list) {
    const k = `${row.vmNamespace}/${row.vmName}`;
    map.set(k, { key: k, alias: row.vmAlias, vmName: row.vmName, vmIp: row.vmIp });
  }
  for (const opt of vmOptions) {
    if (!map.has(opt.value)) {
      map.set(opt.value, { key: opt.value, alias: opt.alias, vmName: opt.vmName, vmIp: opt.vmIp });
    }
  }
  return [...map.values()];
}

function rowMatchesSearch(row: VmRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [row.alias, row.vmName, row.vmIp, row.key].join(' ').toLowerCase().includes(s);
}

function ruleCardTitle(tab: SgAclDirection): string {
  if (tab === 'inbound') return '入方向规则';
  if (tab === 'outbound') return '出方向规则';
  return '访问控制规则';
}

const MemberVmListRow: React.FC<{
  row: VmRow;
  mode: 'joined' | 'available';
  readOnly: boolean;
  onAction: () => void;
}> = ({ row, mode, readOnly, onAction }) => {
  const aliasTrim = String(row.alias).trim();
  const nameTrim = String(row.vmName).trim();
  /** 无注解别名时兜底为虚拟机 metadata.name */
  const aliasShown = aliasTrim || nameTrim || '—';
  const ipStr = String(row.vmIp).trim() || '—';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderBottom: '1px solid var(--ant-color-split)',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.5,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span>
          {aliasShown} / {ipStr}
        </span>
        <Tag
          color={mode === 'joined' ? 'success' : 'error'}
          style={{ margin: 0 }}
        >
          {mode === 'joined' ? '已加入' : '未加入'}
        </Tag>
      </div>
      <div style={{ flexShrink: 0 }}>
        {mode === 'joined' ? (
          <Button size="small" danger disabled={readOnly} onClick={onAction}>
            移出
          </Button>
        ) : (
          <Button type="primary" size="small" disabled={readOnly} onClick={onAction}>
            加入
          </Button>
        )}
      </div>
    </div>
  );
};

const SecurityGroupAccessControlDrawer: React.FC<SecurityGroupAccessControlDrawerProps> = ({
  AntDrawer,
  open,
  onClose,
  target,
  loading,
  saving,
  onSave,
  form,
  readOnly,
  tab,
  onTabChange,
  serverMemberCount,
  memberKeys,
  onMemberKeysChange,
  members,
}) => {
  const [memberSearch, setMemberSearch] = useState('');
  useEffect(() => {
    if (!open) setMemberSearch('');
  }, [open]);

  const inboundRules = Form.useWatch('inboundRules', form) as SubnetAclFormRow[] | undefined;
  const outboundRules = Form.useWatch('outboundRules', form) as SubnetAclFormRow[] | undefined;
  const inboundCount = useMemo(() => (Array.isArray(inboundRules) ? inboundRules.length : 0), [inboundRules]);
  const outboundCount = useMemo(() => (Array.isArray(outboundRules) ? outboundRules.length : 0), [outboundRules]);

  const allVmRows = useMemo(
    () => buildAllVmRows(members.list, members.vmOptions),
    [members.list, members.vmOptions],
  );

  const memberKeySet = useMemo(() => new Set(memberKeys), [memberKeys]);

  const joinedRows = useMemo(() => {
    return allVmRows
      .filter((r) => memberKeySet.has(r.key))
      .filter((r) => rowMatchesSearch(r, memberSearch));
  }, [allVmRows, memberKeySet, memberSearch]);

  const availableRows = useMemo(() => {
    return allVmRows
      .filter((r) => !memberKeySet.has(r.key))
      .filter((r) => rowMatchesSearch(r, memberSearch));
  }, [allVmRows, memberKeySet, memberSearch]);

  const showRulesCard = tab === 'inbound' || tab === 'outbound';
  const showMembersCard = tab === 'members';
  const saveDisabled = readOnly || loading || saving;
  const memberBadge = tab === 'members' ? memberKeys.length : serverMemberCount;

  return (
    <AntDrawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      destroyOnHidden
      styles={{
        body: { padding: 0, background: '#f5f7fa', display: 'flex', flexDirection: 'column' },
      }}
    >
      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="harvester-drawer-title-icon-wrap">
            <SafetyOutlined />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>访问控制</div>
            <div style={{ fontSize: 12, color: '#999' }}>
              {target ? (
                <>
                  {target.name} · 子网{' '}
                  <Text code title={target.subnetName}>
                    {target.subnetDisplayLabel ?? target.subnetName}
                  </Text>
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
        <Button
          type="text"
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            fontSize: 16,
            padding: 0,
            color: '#666',
          }}
        >
          <CloseOutlined />
        </Button>
      </div>

      <style>{`
        .sg-access-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .sg-access-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .sg-access-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .sg-access-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
        .sg-access-drawer-scroll::-webkit-scrollbar-button { display: none; }
      `}</style>

      <div
        className="sg-access-drawer-scroll"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <Spin
          spinning={loading}
          tip="加载中…"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
              <div style={{ padding: '0 0 16px 0' }}>
                <div style={{ padding: 4, background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                  <Segmented
                    size="small"
                    value={tab}
                    disabled={loading || saving}
                    onChange={(v) => onTabChange(v as SgAclDirection)}
                    options={[
                      { label: `入方向 (${inboundCount})`, value: 'inbound', icon: <ImportOutlined /> },
                      { label: `出方向 (${outboundCount})`, value: 'outbound', icon: <ExportOutlined /> },
                      {
                        label: `关联云主机 (${memberBadge})`,
                        value: 'members',
                        icon: <TeamOutlined />,
                      },
                    ]}
                  />
                </div>
              </div>
            </div>

            <div className="minimal-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 24px 12px' }}>
              <div style={showRulesCard ? show : hide}>
                <Card
                  variant="borderless"
                  title={ruleCardTitle(tab)}
                  extra={
                    !readOnly ? (
                      <Button type="primary" loading={saving} disabled={saveDisabled} onClick={onSave}>
                        保存
                      </Button>
                    ) : null
                  }
                  styles={{ body: { padding: 16 } }}
                  style={{ border: '1px solid #e0e0e0', borderRadius: 8 }}
                >
                  <Form form={form} component={false} layout="vertical" className="std-form" disabled={readOnly}>
                    <div style={tab === 'inbound' ? show : hide}>
                      <DirectionRuleBlock listName="inboundRules" variant="inbound" />
                    </div>
                    <div style={tab === 'outbound' ? show : hide}>
                      <DirectionRuleBlock listName="outboundRules" variant="outbound" />
                    </div>
                  </Form>
                </Card>
              </div>

              <div style={showMembersCard ? show : hide}>
                <Card
                  variant="borderless"
                  title="关联云主机"
                  extra={
                    !readOnly ? (
                      <Button type="primary" loading={saving} disabled={saveDisabled} onClick={onSave}>
                        保存
                      </Button>
                    ) : null
                  }
                  styles={{ body: { padding: 16 } }}
                  style={{ border: '1px solid #e0e0e0', borderRadius: 8 }}
                >
                  <Input
                    allowClear
                    placeholder="搜索别名、主机名或 IP"
                    prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    style={{ marginBottom: 16 }}
                    disabled={loading}
                  />

                  <div style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#fafafa',
                        border: '1px solid var(--ant-color-split)',
                        borderBottom: 'none',
                        borderRadius: '8px 8px 0 0',
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      已加入安全组（{joinedRows.length}）
                    </div>
                    <div
                      style={{
                        border: '1px solid var(--ant-color-split)',
                        borderRadius: '0 0 8px 8px',
                        overflow: 'hidden',
                        background: '#fff',
                        minHeight: 56,
                      }}
                    >
                      {joinedRows.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            memberSearch.trim()
                              ? '无匹配结果'
                              : '暂无已加入的云主机'
                          }
                          style={{ padding: '16px 0' }}
                        />
                      ) : (
                        joinedRows.map((row) => (
                          <MemberVmListRow
                            key={row.key}
                            row={row}
                            mode="joined"
                            readOnly={readOnly}
                            onAction={() =>
                              onMemberKeysChange(memberKeys.filter((k) => k !== row.key))
                            }
                          />
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#fafafa',
                        border: '1px solid var(--ant-color-split)',
                        borderBottom: 'none',
                        borderRadius: '8px 8px 0 0',
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      未加入安全组（{availableRows.length}）
                    </div>
                    <div
                      style={{
                        border: '1px solid var(--ant-color-split)',
                        borderRadius: '0 0 8px 8px',
                        overflow: 'hidden',
                        background: '#fff',
                        minHeight: 56,
                      }}
                    >
                      {availableRows.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            memberSearch.trim()
                              ? '无匹配结果'
                              : '暂无未加入的云主机'
                          }
                          style={{ padding: '16px 0' }}
                        />
                      ) : (
                        availableRows.map((row) => (
                          <MemberVmListRow
                            key={row.key}
                            row={row}
                            mode="available"
                            readOnly={readOnly}
                            onAction={() =>
                              onMemberKeysChange(
                                memberKeys.includes(row.key) ? memberKeys : [...memberKeys, row.key],
                              )
                            }
                          />
                        ))
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </Spin>
      </div>
    </AntDrawer>
  );
};

export default SecurityGroupAccessControlDrawer;
