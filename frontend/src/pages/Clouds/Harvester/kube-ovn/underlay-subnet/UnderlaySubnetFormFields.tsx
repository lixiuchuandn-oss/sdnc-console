import React from 'react';
import type { FormInstance } from 'antd/es/form';
import { Form, Input, Select } from 'antd';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../utils/towerKubeOvnNames';
import { TOWER_ALIAS_ANNOTATION } from './constants';

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

/** 下拉框仅展示：VLAN 标签 · 物理网络(别名优先) */
export function vlanRecordLabelForSelect(v: any, providers: any[]): string {
  const tag = v?.spec?.id;
  const tagStr = tag !== undefined && tag !== null ? String(tag) : '—';
  const prov = providerDisplayName(String(v?.spec?.provider ?? '').trim(), providers);
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

export type UnderlaySubnetFormFieldsProps = {
  form: FormInstance;
  isFlatMode: boolean;
  vlans: any[];
  /** 仅公共子网使用（扁平子网不展示物理网络） */
  providers?: any[];
  aliasDupCheckItems: any[];
  /** 创建流程可传入更详细的「自动生成 metadata.name」说明 */
  aliasFieldTooltip?: string;
  /** 编辑时传入当前子网 metadata.name，别名重复校验时排除自身 */
  editingSubnetResourceName?: string | null;
};

const UnderlaySubnetFormFields: React.FC<UnderlaySubnetFormFieldsProps> = ({
  form: _form,
  isFlatMode,
  vlans,
  providers,
  aliasDupCheckItems,
  aliasFieldTooltip,
  editingSubnetResourceName,
}) => (
  <>
    <Form.Item
      name="alias"
      label={isFlatMode ? '名称' : '别名'}
      tooltip={
        aliasFieldTooltip ||
        '展示名称，支持中文；写入注解 tower.io/alias。子网在集群中的资源名（metadata.name）创建后不可改。'
      }
      rules={[
        { required: true, message: isFlatMode ? '请输入名称' : '请输入别名' },
        { max: 200, message: isFlatMode ? '名称不超过 200 字' : '别名不超过 200 字' },
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
              return Promise.reject(new Error(isFlatMode ? '名称已存在，请修改' : '别名已存在，请修改'));
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
    <Form.Item name="excludeIps" label="排除 IP (可选)" extra="多 IP 请换行输入">
      <Input.TextArea rows={3} placeholder="每行一个 IP 或 IP 范围 (e.g. 192.168.1.1..192.168.1.10)" />
    </Form.Item>
  </>
);

export default UnderlaySubnetFormFields;
