import React from 'react';
import type { FormInstance } from 'antd/es/form';
import { Form, Input, Select } from 'antd';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';
import { TOWER_ALIAS_ANNOTATION } from './kubeOvnSubnetConstants';

const { Option } = Select;

export function providerDisplayName(providerName: string, providers: any[]): string {
  const pn = String(providerName ?? '').trim();
  if (!pn) return '未指定';
  const hit = Array.isArray(providers)
    ? providers.find((p) => String(p?.metadata?.name ?? '').trim() === pn)
    : undefined;
  if (!hit) return pn;
  const ann = hit?.metadata?.annotations || {};
  const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] ?? '').trim();
  return alias || pn;
}

/** 下拉框展示：VLAN 展示名（注解 tower.io/alies）· 标签号 · 物理网络（别名优先） */
export function vlanRecordLabelForSelect(v: any, providers: any[]): string {
  const ann = v?.metadata?.annotations || {};
  const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] ?? '').trim();
  const tag = v?.spec?.id;
  const tagStr = tag !== undefined && tag !== null ? String(tag) : '—';
  const prov = providerDisplayName(String(v?.spec?.provider ?? '').trim(), providers);
  if (alias) {
    return `${alias} · VLAN ${tagStr} · ${prov}`;
  }
  return `VLAN ${tagStr} - ${prov}`;
}

/** 供搜索：集群资源名、标签号、物理网络（界面不展示资源名） */
export function vlanRecordSearchBlob(v: any, providers: any[]): string {
  const metaName = String(v?.metadata?.name ?? '').trim();
  const tag = v?.spec?.id;
  const providerName = String(v?.spec?.provider ?? '').trim();
  const providerAlias = providerDisplayName(providerName, providers);
  return [metaName, tag !== undefined && tag !== null ? String(tag) : '', providerName, providerAlias]
    .filter(Boolean)
    .join(' ');
}

/**
 * 根据子网 `spec.vlan`（VLAN CR 的 metadata.name，或少数场景下的 VLAN 数字 ID）在列表中解析对象。
 * 兼容 `namespace/name`、资源名大小写差异。
 */
export function findVlanRecordBySubnetRef(vlanRef: string, vlans: any[]): any | undefined {
  const raw = String(vlanRef ?? '').trim();
  if (!raw || !Array.isArray(vlans)) return undefined;
  const r = raw.includes('/') ? String(raw.split('/').pop() ?? '').trim() : raw;
  if (!r) return undefined;
  const rLower = r.toLowerCase();
  return vlans.find((v) => {
    const mn = String(v?.metadata?.name ?? '').trim();
    if (mn === r || mn.toLowerCase() === rLower) return true;
    const id = v?.spec?.id;
    if (id !== undefined && id !== null) {
      const idStr = String(id).trim();
      if (idStr === r || idStr.toLowerCase() === rLower) return true;
    }
    return false;
  });
}

/**
 * 子网详情「VLAN信息」：VLAN 行用展示名/标签；物理网络优先注解，否则从 VLAN.spec.provider 解析（Subnet.spec.provider 为 OVN 逻辑名，不能当物理网络用）。
 */
export function vlanDetailDisplayParts(
  vlanRef: string,
  vlans: any[] | undefined,
  providers: any[] | undefined,
  providerHint: string,
  vpcDisplay: string,
): {
  vlanText: string;
  vlanTitle: string | undefined;
  physicalText: string;
  physicalTitle: string | undefined;
} {
  const list = vlans ?? [];
  const provs = providers ?? [];
  const hint = String(providerHint ?? '').trim();
  const vpc = String(vpcDisplay ?? '').trim();
  const r = String(vlanRef ?? '').trim();
  if (!r) {
    const plain = vpc ? '—' : 'overlay';
    const title = !vpc ? '未绑定 VLAN，纯 OVN overlay' : undefined;
    return { vlanText: plain, vlanTitle: title, physicalText: '—', physicalTitle: undefined };
  }
  const hit = findVlanRecordBySubnetRef(r, list);
  const physicalRaw = hint || String(hit?.spec?.provider ?? '').trim();
  const physicalText = physicalRaw ? providerDisplayName(physicalRaw, provs) : '—';
  const physicalTitle =
    physicalRaw && physicalText !== physicalRaw ? `物理网络资源名：${physicalRaw}` : undefined;

  if (hit) {
    const ann = hit?.metadata?.annotations || {};
    const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] ?? '').trim();
    const tag = hit?.spec?.id;
    const tagStr = tag !== undefined && tag !== null ? String(tag) : '—';
    const crName = String(hit?.metadata?.name ?? '').trim();
    const vlanText = alias ? `${alias}（VLAN ${tagStr}）` : `VLAN ${tagStr}`;
    const vlanTitle = crName ? `VLAN 资源名：${crName}` : undefined;
    return { vlanText, vlanTitle, physicalText, physicalTitle };
  }

  return {
    vlanText: r,
    vlanTitle: '未在已加载的 VLAN 列表中匹配，可刷新页面后重试；上为子网中的 VLAN 引用',
    physicalText: hint ? providerDisplayName(hint, provs) : '—',
    physicalTitle: hint && providerDisplayName(hint, provs) !== hint ? `物理网络资源名：${hint}` : undefined,
  };
}

export type UnderlaySubnetFormFieldsProps = {
  form: FormInstance;
  isFlatMode: boolean;
  vlans: any[];
  /** 仅公共子网使用（扁平子网不展示物理网络） */
  providers?: any[];
  aliasDupCheckItems: any[];
  /** 创建流程可传入更详细的「自动生成 metadata.name」说明 */
  aliasFieldTooltip?: string;
  /** 编辑时传入当前子网 metadata.name，名称重复校验时排除自身 */
  editingSubnetResourceName?: string | null;
  /** 公共子网编辑：仅允许修改名称，不展示网段/VLAN 等 */
  publicEditNameOnly?: boolean;
};

const UnderlaySubnetFormFields: React.FC<UnderlaySubnetFormFieldsProps> = ({
  form: _form,
  isFlatMode,
  vlans,
  providers,
  aliasDupCheckItems,
  aliasFieldTooltip,
  editingSubnetResourceName,
  publicEditNameOnly,
}) => {
  if (publicEditNameOnly) {
    return (
      <Form.Item
        name="alias"
        label="名称"
        tooltip="展示名称，支持中文。公共子网的网段、网关、VLAN 等创建后不可在此修改。"
        rules={[
          { required: true, message: '请输入名称' },
          { max: 200, message: '名称不超过 200 字' },
          {
            validator: async (_, value) => {
              const s = String(value ?? '').trim();
              if (!s) return Promise.resolve();
              const dup = aliasDupCheckItems.some((item: any) => {
                if (editingSubnetResourceName && item?.metadata?.name === editingSubnetResourceName) return false;
                const a = String(item?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                return a.length > 0 && a === s;
              });
              if (dup) {
                return Promise.reject(new Error('名称已存在，请修改'));
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input placeholder="显示名称（支持中文）" />
      </Form.Item>
    );
  }
  return (
  <>
    <Form.Item
      name="alias"
      label="名称"
      rules={[
        { required: true, message: '请输入名称' },
        { max: 200, message: '名称不超过 200 字' },
        {
          validator: async (_, value) => {
            const s = String(value ?? '').trim();
            if (!s) return Promise.resolve();
            const dup = aliasDupCheckItems.some((item: any) => {
              if (editingSubnetResourceName && item?.metadata?.name === editingSubnetResourceName) return false;
              const a = String(item?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
              return a.length > 0 && a === s;
            });
            if (dup) {
              return Promise.reject(new Error('名称已存在，请修改'));
            }
            return Promise.resolve();
          },
        },
      ]}
    >
      <Input placeholder="显示名称（支持中文）" />
    </Form.Item>
    <Form.Item name="cidrBlock" label="CIDR" rules={[{ required: true }]}>
      <Input placeholder="192.168.1.0/24" />
    </Form.Item>
    <Form.Item name="gateway" label="网关" rules={[{ required: true }]}>
      <Input placeholder="192.168.1.1" />
    </Form.Item>
    <Form.Item
      name="vlan"
      label="VLAN"
      tooltip={
        isFlatMode
          ? '需要与物理网络对接时选择集群已有 VLAN；不选则仅为 OVN 虚拟二层（overlay），不绑定物理 VLAN。'
          : '公共子网必须选择 VLAN，请从集群已有 VLAN 中选择。'
      }
      rules={isFlatMode ? undefined : [{ required: true, message: '公共子网必须选择 VLAN' }]}
    >
      <Select
        placeholder={isFlatMode ? '可选（不选 = 纯 overlay）' : '请选择 VLAN'}
        allowClear
        showSearch={isFlatMode}
        optionFilterProp="label"
        dropdownStyle={{ minWidth: 280 }}
      >
        {vlans.map((v) => (
          <Option key={v.metadata.name} value={v.metadata.name} label={vlanRecordSearchBlob(v, providers || [])}>
            {vlanRecordLabelForSelect(v, providers || [])}
          </Option>
        ))}
      </Select>
    </Form.Item>
    <Form.Item
      name="excludeIps"
      label="排除 IP (可选)"
      tooltip={
        isFlatMode
          ? '单行 IPv4：须落在上方 CIDR 内，且不能与当前云内任意虚拟机正在使用的 IP 相同（含 `..` 区间时由集群校验）。'
          : undefined
      }
    >
      <Input.TextArea rows={3} placeholder="每行一个 IP 或 IP 范围 (e.g. 192.168.1.1..192.168.1.10)，多 IP 请换行输入。IP 范围支持 IPv4 和 IPv6。" />
    </Form.Item>
  </>
  );
};

export default UnderlaySubnetFormFields;
