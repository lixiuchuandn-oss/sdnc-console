import React from 'react';
import { Button, Col, Form, Input, InputNumber, Row, Select } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';

export type MatchL4 = 'ip4' | 'tcp' | 'udp' | 'icmp';

/** 五元组表单字段；提交时由 composeMatchFromInputs 合成 match */
export type SubnetAclFormRow = {
  action?: string;
  direction?: string;
  match?: string;
  priority?: number;
  matchL4?: MatchL4;
  matchSrcIp?: string;
  matchDstIp?: string;
  matchSrcPort?: number | null;
  matchDstPort?: number | null;
};

function validateIpCidr(value: string): boolean {
  if (!value || !value.trim()) return true;
  const trimmed = value.trim();
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/;
  const match = trimmed.match(ipv4Regex);
  if (!match) return false;
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return false;
  }
  if (match[6]) {
    const prefix = parseInt(match[6], 10);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
  }
  return true;
}

const ACL_ACTIONS = [
  { label: '拒绝', value: 'drop' },
  { label: '允许', value: 'allow' },
];

const ACL_DIRECTIONS = [
  { label: '入方向', value: 'from-lport' },
  { label: '出方向', value: 'to-lport' },
];

const L4_OPTIONS: { label: string; value: MatchL4 }[] = [
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
];

type ParsedSimple = {
  matchL4: MatchL4;
  src: string;
  dst: string;
  sport?: number;
  dport?: number;
};

/** 将 API 的 match 回填为表单；无法解析则重置为 L3 空条件（保存时会用新值覆盖） */
export function normalizeAclRowForForm(row: Record<string, unknown>): SubnetAclFormRow {
  const m = String(row.match ?? '').trim();
  const parsed = parseSimpleMatch(m);
  
  if (parsed !== null) {
    return {
      ...row,
      matchL4: parsed.matchL4,
      matchSrcIp: parsed.src,
      matchDstIp: parsed.dst,
      matchSrcPort: parsed.sport ?? null,
      matchDstPort: parsed.dport ?? null,
    } as SubnetAclFormRow;
  }
  return {
    ...row,
    matchL4: 'ip4',
    matchSrcIp: '',
    matchDstIp: '',
    matchSrcPort: null,
    matchDstPort: null,
  } as SubnetAclFormRow;
}

function parseSimpleMatch(m: string): ParsedSimple | null {
  const s = m.trim();
  if (!s) return { matchL4: 'ip4', src: '', dst: '' };
  const parts = s.split(/\s*&&\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts[0] !== 'ip4') return null;

  let matchL4: MatchL4 = 'ip4';
  let src = '';
  let dst = '';
  let sport: number | undefined;
  let dport: number | undefined;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p === 'tcp') {
      if (matchL4 !== 'ip4') return null;
      matchL4 = 'tcp';
      continue;
    }
    if (p === 'udp') {
      if (matchL4 !== 'ip4') return null;
      matchL4 = 'udp';
      continue;
    }
    if (p === 'icmp') {
      if (matchL4 !== 'ip4') return null;
      matchL4 = 'icmp';
      continue;
    }
    let mm = /^ip4\.src\s*==\s*(\S+)$/.exec(p);
    if (mm) {
      src = mm[1];
      continue;
    }
    mm = /^ip4\.dst\s*==\s*(\S+)$/.exec(p);
    if (mm) {
      dst = mm[1];
      continue;
    }
    mm = /^tcp\.src\s*==\s*(\d+)$/.exec(p);
    if (mm) {
      sport = Number(mm[1]);
      matchL4 = 'tcp';
      continue;
    }
    mm = /^tcp\.dst\s*==\s*(\d+)$/.exec(p);
    if (mm) {
      dport = Number(mm[1]);
      matchL4 = 'tcp';
      continue;
    }
    mm = /^udp\.src\s*==\s*(\d+)$/.exec(p);
    if (mm) {
      sport = Number(mm[1]);
      matchL4 = 'udp';
      continue;
    }
    mm = /^udp\.dst\s*==\s*(\d+)$/.exec(p);
    if (mm) {
      dport = Number(mm[1]);
      matchL4 = 'udp';
      continue;
    }
    return null;
  }

  if (parts.length === 1) {
    return { matchL4: 'ip4', src: '', dst: '' };
  }

  return { matchL4, src, dst, sport, dport };
}

function numPort(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 65535 ? n : null;
}

/**
 * 合成 OVN match。协议选 L3 但填了端口时，按 TCP 带端口拼接（OVN 里端口需配合 tcp/udp）。
 * ICMP 无 TCP/UDP 端口语义，填了端口也不会写入 match（避免非法表达式）。
 */
function composeMatchFromInputs(r: SubnetAclFormRow): string {
  const proto = (r.matchL4 ?? 'ip4') as MatchL4;
  const src = String(r.matchSrcIp ?? '').trim();
  const dst = String(r.matchDstIp ?? '').trim();
  const sport = numPort(r.matchSrcPort);
  const dport = numPort(r.matchDstPort);

  let effective: MatchL4 = proto;
  if (proto === 'ip4' && (sport != null || dport != null)) {
    effective = 'tcp';
  }

  const parts: string[] = ['ip4'];

  if (effective === 'tcp') parts.push('tcp');
  else if (effective === 'udp') parts.push('udp');
  else if (effective === 'icmp') parts.push('icmp');

  if (src) parts.push(`ip4.src == ${src}`);
  if (dst) parts.push(`ip4.dst == ${dst}`);

  if (effective === 'tcp') {
    if (sport != null) parts.push(`tcp.src == ${sport}`);
    if (dport != null) parts.push(`tcp.dst == ${dport}`);
  } else if (effective === 'udp') {
    if (sport != null) parts.push(`udp.src == ${sport}`);
    if (dport != null) parts.push(`udp.dst == ${dport}`);
  }

  if (parts.length === 1) return 'ip4';
  return parts.join(' && ');
}

export function normalizeAclsForApi(rows: SubnetAclFormRow[] | undefined | null): Array<{
  action: string;
  direction: string;
  match: string;
  priority: number;
}> {
  if (!rows || !Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const action = String(r?.action || '').trim();
      const direction = String(r?.direction || '').trim();
      const priority = Number(r?.priority);
      const match = composeMatchFromInputs(r);
      return { action, direction, match, priority };
    })
    .filter((r) => r.action && r.direction && r.match && Number.isFinite(r.priority));
}

/** 未填写任何有效语义时可忽略（如用户点了「添加规则」又清空，或仅剩默认 L3） */
export function isBlankAclFormRow(r: SubnetAclFormRow | undefined | null): boolean {
  if (!r || typeof r !== 'object') return true;
  const action = String(r.action ?? '').trim();
  const direction = String(r.direction ?? '').trim();
  const priority = Number(r.priority);
  const src = String(r.matchSrcIp ?? '').trim();
  const dst = String(r.matchDstIp ?? '').trim();
  const sport = numPort(r.matchSrcPort);
  const dport = numPort(r.matchDstPort);
  const proto = (r.matchL4 ?? 'ip4') as MatchL4;
  if (action || direction) return false;
  if (Number.isFinite(priority)) return false;
  if (src || dst || sport != null || dport != null) return false;
  if (proto !== 'ip4') return false;
  return true;
}

/**
 * 与 normalizeAclsForApi 配套：禁止「有填写意图的行」被静默丢弃后仍当成功下发。
 */
export function validateAclsFormRowsForSubmit(
  rows: SubnetAclFormRow[] | undefined | null,
):
  | {
      ok: true;
      normalized: Array<{ action: string; direction: string; match: string; priority: number }>;
    }
  | { ok: false; message: string } {
  const list = Array.isArray(rows) ? rows : [];
  const nonBlank = list.filter((r) => !isBlankAclFormRow(r));
  const normalized = normalizeAclsForApi(list);
  if (nonBlank.length !== normalized.length) {
    return {
      ok: false,
      message:
        '存在未填写完整或无效的 ACL 规则（每条需动作、方向、优先级 1–32767；匹配条件按协议填写）。请补全或删除多余空行后再保存。',
    };
  }
  return { ok: true, normalized };
}

const itemNoMargin = { marginBottom: 0 };

/** 单条 ACL 一行：优先级 → 动作 → 方向 → 协议 → 源/目的/端口 → 删除 */
const AclRuleOneRow: React.FC<{
  restField: Record<string, unknown>;
  listIndex: number;
  onRemove: () => void;
}> = ({ restField, listIndex, onRemove }) => {
  const showPorts = true;
  return (
    <div style={{ width: '100%', overflowX: 'auto', marginBottom: 10 }}>
      <Row wrap={false} align="top" gutter={[10, 8]} style={{ minWidth: 800, width: '100%' }}>
        <Col flex="88px" style={{ minWidth: 88 }}>
          <Form.Item 
            {...restField} 
            name={[listIndex, 'priority']} 
            rules={[
              { required: true, message: '优先级' },
              {
                validator: (_, value) => {
                  const p = Number(value);
                  if (Number.isFinite(p) && p >= 31000 && p <= 39999) {
                    return Promise.reject(new Error('优先级 31000-39999 为安全组专用'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            style={{ marginBottom: 0 }}
            validateTrigger={['onChange', 'onBlur']}
          >
            <InputNumber 
              size="middle" 
              min={1} 
              max={32767} 
              placeholder="优先级" 
              style={{ width: '100%' }} 
              controls 
            />
          </Form.Item>
        </Col>

        <Col flex="100px" style={{ minWidth: 100 }}>
          <Form.Item {...restField} name={[listIndex, 'direction']} rules={[{ required: true, message: '方向' }]} style={itemNoMargin}>
            <Select size="middle" options={ACL_DIRECTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col flex="100px" style={{ minWidth: 100 }}>
          <Form.Item {...restField} name={[listIndex, 'matchL4']} style={itemNoMargin}>
            <Select size="middle" placeholder="协议" options={L4_OPTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col flex="1 1 160px" style={{ minWidth: 140 }}>
          <Form.Item
            {...restField}
            name={[listIndex, 'matchSrcIp']}
            style={itemNoMargin}
            rules={[
              {
                validator: (_, value) => {
                  if (!value || !String(value).trim()) return Promise.resolve();
                  if (!validateIpCidr(String(value))) {
                    return Promise.reject(new Error('请输入有效的IP或CIDR格式，如 192.168.1.1 或 192.168.1.0/24'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            validateTrigger={['onChange', 'onBlur']}
          >
            <Input size="middle" placeholder="源 IP" allowClear />
          </Form.Item>
        </Col>
        <Col flex="88px" style={{ minWidth: 88 }}>
          <Form.Item {...restField} name={[listIndex, 'matchSrcPort']} style={itemNoMargin}>
            <InputNumber
              size="middle"
              min={0}
              max={65535}
              placeholder="源端口"
              disabled={!showPorts}
              style={{ width: '100%' }}
              controls={false}
            />
          </Form.Item>
        </Col>
        <Col flex="1 1 160px" style={{ minWidth: 140 }}>
          <Form.Item
            {...restField}
            name={[listIndex, 'matchDstIp']}
            style={itemNoMargin}
            rules={[
              {
                validator: (_, value) => {
                  if (!value || !String(value).trim()) return Promise.resolve();
                  if (!validateIpCidr(String(value))) {
                    return Promise.reject(new Error('请输入有效的IP或CIDR格式，如 192.168.1.1 或 192.168.1.0/24'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            validateTrigger={['onChange', 'onBlur']}
          >
            <Input size="middle" placeholder="目的 IP" allowClear />
          </Form.Item>
        </Col>

        <Col flex="88px" style={{ minWidth: 88 }}>
          <Form.Item {...restField} name={[listIndex, 'matchDstPort']} style={itemNoMargin}>
            <InputNumber
              size="middle"
              min={0}
              max={65535}
              placeholder="目的端口"
              disabled={!showPorts}
              style={{ width: '100%' }}
              controls={false}
            />
          </Form.Item>
        </Col>
        <Col flex="100px" style={{ minWidth: 100 }}>
          <Form.Item {...restField} name={[listIndex, 'action']} rules={[{ required: true, message: '动作' }]} style={itemNoMargin}>
            <Select size="middle" options={ACL_ACTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col flex="none" style={{ flexShrink: 0, paddingTop: 4 }}>
          <MinusCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} onClick={onRemove} />
        </Col>
      </Row>
    </div>
  );
};

const SubnetAclFormItems: React.FC = () => (
  <div>
    <Form.List name="acls">
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...restField }) => (
            <AclRuleOneRow key={key} restField={restField} listIndex={name} onRemove={() => remove(name)} />
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() =>
              add({
                action: 'drop',
                direction: 'from-lport',
                priority: 1000,
                matchL4: 'tcp',
                matchSrcIp: '',
                matchDstIp: '',
                matchSrcPort: null,
                matchDstPort: null,
              })
            }
          >
            添加规则
          </Button>
        </>
      )}
    </Form.List>
  </div>
);

export default SubnetAclFormItems;
