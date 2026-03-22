import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd/es/form/Form';
import {
  ExportOutlined,
  ImportOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { SubnetAclFormRow } from './SubnetAclFormItems';

const { Text } = Typography;

/** 严格版式：Alias / metadata.name [IP 徽章] */
const VmAliasNameIp: React.FC<{ alias: string; metadataName: string; ip: string }> = ({
  alias,
  metadataName,
  ip,
}) => {
  const aliasShown = String(alias).trim() || '—';
  const ipStr = String(ip).trim();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, lineHeight: 1.5 }}>
      <span>
        <span>{aliasShown}</span>
        <Text type="secondary"> / </Text>
        <Text code>{metadataName}</Text>
      </span>
      {ipStr ? (
        <Tag color="blue" style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, maxWidth: '100%' }}>
          {ipStr}
        </Tag>
      ) : null}
    </span>
  );
};

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

export type SecurityGroupAclTabsFormProps = {
  rulesForm: FormInstance;
  /** 仅作用于入/出方向规则编辑区 */
  rulesDisabled?: boolean;
  direction: SgAclDirection;
  onDirectionChange: (d: SgAclDirection) => void;
  memberCount: number;
  /** 入/出方向与成员管理共用的「保存」，固定在抽屉内容区底部卡片内（不在标题行） */
  canSave: boolean;
  saveLoading: boolean;
  onSave: () => void;
  members: {
    loading: boolean;
    list: SgMemberRow[];
    vmOptions: SgVmOptionRow[];
    removingMemberId: string | null;
    joiningVmKey: string | null;
    canWrite: boolean;
    onJoinVm: (vmKey: string) => void | Promise<void>;
    onRemoveMember: (m: SgMemberRow) => void;
  };
};

/** 与阿里云安全组控制台接近：允许 / 拒绝；OVN 另支持 pass */
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

type Variant = 'inbound' | 'outbound';

/**
 * 单方向一条规则（无 direction 字段；由 Tab 决定 from-lport / to-lport）
 */
const SecurityGroupAclRuleRow: React.FC<{
  restField: Record<string, unknown>;
  listIndex: number;
  variant: Variant;
  onRemove: () => void;
}> = ({ restField, listIndex, onRemove, variant }) => {
  const isInbound = variant === 'inbound';

  return (
    <div style={{ width: '100%', overflowX: 'auto', marginBottom: 12 }}>
      <Row wrap={false} align="top" gutter={[10, 8]} style={{ minWidth: isInbound ? 720 : 720, width: '100%' }}>
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

        {/* 隐藏字段：保证提交时另一侧为空，避免误带旧值 */}
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

function vmListMatchesKeyword(
  kw: string,
  fields: { alias: string; vmName: string; vmNamespace: string; vmIp: string; fullKey: string },
): boolean {
  const k = kw.trim().toLowerCase();
  if (!k) return true;
  const blob = [
    fields.alias,
    fields.vmName,
    fields.vmNamespace,
    fields.vmIp,
    fields.fullKey,
  ]
    .join(' ')
    .toLowerCase();
  return blob.includes(k);
}

/** 与 HarvesterVmDetailDrawer 虚拟磁盘/网卡等块一致：标题在卡片外 */
const MembersPanel: React.FC<{ m: SecurityGroupAclTabsFormProps['members'] }> = ({ m }) => {
  const [joinedSearch, setJoinedSearch] = useState('');
  const [availableSearch, setAvailableSearch] = useState('');

  const filteredJoined = useMemo(
    () =>
      m.list.filter((row) =>
        vmListMatchesKeyword(joinedSearch, {
          alias: row.vmAlias,
          vmName: row.vmName,
          vmNamespace: row.vmNamespace,
          vmIp: row.vmIp,
          fullKey: `${row.vmNamespace}/${row.vmName}`,
        }),
      ),
    [m.list, joinedSearch],
  );

  const filteredAvailable = useMemo(
    () =>
      m.vmOptions.filter((opt) =>
        vmListMatchesKeyword(availableSearch, {
          alias: opt.alias,
          vmName: opt.vmName,
          vmNamespace: opt.vmNamespace,
          vmIp: opt.vmIp,
          fullKey: opt.value,
        }),
      ),
    [m.vmOptions, availableSearch],
  );

  return (
  <Spin spinning={m.loading}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#666' }}>已加入云主机</span>
        </div>
        <Card
          variant="borderless"
          styles={{ body: { padding: 0 } }}
          style={{ border: '1px solid #e0e0e0', borderRadius: 8 }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--ant-color-split, #f0f0f0)',
            }}
          >
            <Input
              allowClear
              placeholder="搜索名称/ID/IP 地址"
              style={{ maxWidth: '100%' }}
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={joinedSearch}
              onChange={(e) => setJoinedSearch(e.target.value)}
            />
          </div>
          <List<SgMemberRow>
            size="small"
            dataSource={filteredJoined}
            locale={{
              emptyText:
                m.list.length === 0
                  ? '暂无已加入云主机'
                  : joinedSearch.trim() && filteredJoined.length === 0
                    ? '无匹配结果'
                    : '暂无已加入云主机',
            }}
            style={{ maxHeight: 360, overflow: 'auto' }}
            renderItem={(row) => (
              <List.Item
                key={row.id}
                style={{ padding: '16px 24px' }}
                actions={
                  m.canWrite
                    ? [
                        <Popconfirm
                          key="remove"
                          title="从安全组移除此云主机？"
                          okText="移除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => m.onRemoveMember(row)}
                        >
                          <Button type="link" danger size="small" loading={m.removingMemberId === row.id}>
                            移除
                          </Button>
                        </Popconfirm>,
                      ]
                    : []
                }
              >
                <VmAliasNameIp alias={row.vmAlias} metadataName={row.vmName} ip={row.vmIp} />
              </List.Item>
            )}
          />
        </Card>
      </div>
      <div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#666' }}>可加入云主机</span>
        </div>
        <Card
          variant="borderless"
          styles={{ body: { padding: 0 } }}
          style={{ border: '1px solid #e0e0e0', borderRadius: 8 }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--ant-color-split, #f0f0f0)',
            }}
          >
            <Input
              allowClear
              placeholder="搜索名称/ID/IP 地址"
              style={{ maxWidth: '100%' }}
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={availableSearch}
              onChange={(e) => setAvailableSearch(e.target.value)}
            />
          </div>
          <List<SgVmOptionRow>
            size="small"
            dataSource={filteredAvailable}
            locale={{
              emptyText:
                m.vmOptions.length === 0
                  ? '暂无可加入云主机（须已连接当前扁平子网）'
                  : availableSearch.trim() && filteredAvailable.length === 0
                    ? '无匹配结果'
                    : '暂无可加入云主机（须已连接当前扁平子网）',
            }}
            style={{ maxHeight: 360, overflow: 'auto' }}
            renderItem={(opt) => (
              <List.Item
                key={opt.value}
                style={{ padding: '16px 24px' }}
                actions={
                  m.canWrite
                    ? [
                        <Button
                          key="join"
                          type="link"
                          size="small"
                          loading={m.joiningVmKey === opt.value}
                          disabled={m.loading}
                          onClick={() => m.onJoinVm(opt.value)}
                        >
                          加入
                        </Button>,
                      ]
                    : []
                }
              >
                <VmAliasNameIp alias={opt.alias} metadataName={opt.vmName} ip={opt.vmIp} />
              </List.Item>
            )}
          />
        </Card>
      </div>
    </div>
  </Spin>
  );
};

/**
 * 安全组访问控制：入方向 / 出方向 / 成员管理 共用一个 Segmented；规则字段 inboundRules、outboundRules 由 rulesForm 持有（component=false，避免与成员 Form 嵌套原生 form）
 */
const SecurityGroupAclTabsForm: React.FC<SecurityGroupAclTabsFormProps> = ({
  rulesForm,
  rulesDisabled,
  direction,
  onDirectionChange,
  memberCount,
  canSave,
  saveLoading,
  onSave,
  members,
}) => {
  const inboundRules = Form.useWatch('inboundRules', rulesForm) as SubnetAclFormRow[] | undefined;
  const outboundRules = Form.useWatch('outboundRules', rulesForm) as SubnetAclFormRow[] | undefined;

  const inboundCount = useMemo(() => (Array.isArray(inboundRules) ? inboundRules.length : 0), [inboundRules]);
  const outboundCount = useMemo(() => (Array.isArray(outboundRules) ? outboundRules.length : 0), [outboundRules]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ padding: '0 0 16px 0' }}>
          <div style={{ padding: 4, background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0' }}>
            <Segmented
              size="small"
              value={direction}
              onChange={(v) => onDirectionChange(v as SgAclDirection)}
              options={[
                { label: `入方向 (${inboundCount})`, value: 'inbound', icon: <ImportOutlined /> },
                { label: `出方向 (${outboundCount})`, value: 'outbound', icon: <ExportOutlined /> },
                { label: `成员管理 (${memberCount})`, value: 'members', icon: <TeamOutlined /> },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="minimal-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 24px 12px' }}>
        {direction === 'members' ? (
          <MembersPanel m={members} />
        ) : (
          <Card variant="borderless" styles={{ body: { padding: 16 } }} style={{ border: '1px solid #e0e0e0', borderRadius: 8 }}>
            <Form form={rulesForm} component={false} layout="vertical" className="std-form" disabled={rulesDisabled}>
              {direction === 'inbound' ? (
                <DirectionRuleBlock listName="inboundRules" variant="inbound" />
              ) : (
                <DirectionRuleBlock listName="outboundRules" variant="outbound" />
              )}
            </Form>
          </Card>
        )}
      </div>

      {canSave && (
        <div style={{ flexShrink: 0, padding: '0 24px 16px', background: '#f5f7fa' }}>
          <Card
            variant="borderless"
            styles={{ body: { padding: '12px 16px' } }}
            style={{ border: '1px solid #e0e0e0', borderRadius: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <Button type="primary" loading={saveLoading} onClick={onSave}>
                保存
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default SecurityGroupAclTabsForm;
