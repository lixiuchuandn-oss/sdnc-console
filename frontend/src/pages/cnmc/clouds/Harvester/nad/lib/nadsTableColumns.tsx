import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag, Tooltip } from 'antd';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
} from '../../kube-ovn/lib/kubeOvnSubnetConstants';
import {
  hasLinkedKubeOvnSubnetInMap,
  isKubeOvnCniNad,
  resolveLinkedKubeOvnSubnet,
  subnetTypeToShortLabel,
  type ProcessedNadRecord,
} from './nadsSectionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

export type NadsTableActions = {
  hasNadsWrite: boolean;
  isTenant?: boolean;
  ovnSubnetsLoading: boolean;
  subnetByNameLc: Map<string, unknown>;
  isPublicNamespace: (ns: string) => boolean;
  onOpenYaml: (record: ProcessedNadRecord) => void;
  onDelete: (record: ProcessedNadRecord) => void;
};

export function buildNadsTableColumns(actions: NadsTableActions): ColumnsType<ProcessedNadRecord> {
  const {
    hasNadsWrite,
    isTenant,
    ovnSubnetsLoading,
    subnetByNameLc,
    isPublicNamespace,
    onOpenYaml,
    onDelete,
  } = actions;

  return [
    {
      fixed: 'left',
      title: '网络名称',
      key: 'name',
      render: (_: unknown, r: ProcessedNadRecord) => {
        let displayName = r._alias || r._name || '-';
        if (!r._alias && displayName === 'mgmt') {
          displayName = '管理网';
        }
        return displayName;
      },
    },
    {
      title: '网络ID',
      key: 'id',
      render: (_: unknown, r: ProcessedNadRecord) => r._name || '-',
    },
    {
      title: '项目',
      key: 'ns',
      render: (_: unknown, r: ProcessedNadRecord) => r._namespace || '-',
    },
    {
      title: 'VLAN',
      key: 'vlan',
      render: (_: unknown, r: ProcessedNadRecord) =>
        r._vlan ? <Tag color="blue">{String(r._vlan)}</Tag> : <Tag>未配置</Tag>,
    },
    {
      title: 'IP分配方式',
      key: 'ipamType',
      render: (_: unknown, r: ProcessedNadRecord) => {
        const t = String(r._ipamType || '').toLowerCase();
        if (!t) return <Tag>未配置</Tag>;
        let color: React.ComponentProps<typeof Tag>['color'];
        if (t === 'dhcp') color = 'success';
        else if (t === 'static') color = 'blue';
        else if (t === 'host-local') color = 'orange';
        else color = 'default';
        return <Tag color={color}>{t}</Tag>;
      },
    },
    {
      title: '混杂模式',
      key: 'promisc',
      render: (_: unknown, r: ProcessedNadRecord) =>
        r._promisc ? <Tag color="blue">开启</Tag> : <Tag>未配置</Tag>,
    },
    {
      title: 'CNI 类型',
      key: 'cniPluginType',
      ellipsis: true,
      render: (_: unknown, r: ProcessedNadRecord) => {
        const tp = String(r._type ?? '').trim();
        if (!tp) return '—';
        const isBridge = tp.toLowerCase() === 'bridge';
        const br = String(r._bridge ?? '').trim();
        if (isBridge && br) return `${tp}/${br}`;
        return tp;
      },
    },
    {
      title: 'OVN 子网',
      key: 'ovnSubnet',
      ellipsis: true,
      render: (_: unknown, r: ProcessedNadRecord) => {
        const tp = String(r._type ?? '').trim().toLowerCase();
        if (tp !== 'kube-ovn') {
          return (
            <Tooltip title="当前 CNI 不是 kube-ovn（如 bridge、macvlan），不会与集群里的 Kube-OVN Subnet 做同名配套。">
              无子网绑定
            </Tooltip>
          );
        }
        if (ovnSubnetsLoading) return '加载中…';
        const linked = resolveLinkedKubeOvnSubnet(r, subnetByNameLc) as
          | {
              metadata?: { name?: string; annotations?: Record<string, string> };
              name?: string;
              spec?: { cidrBlock?: string; cidr?: string };
            }
          | null;
        if (!linked) {
          return (
            <Tooltip title="已为 kube-ovn，但在当前子网列表中未找到同名或 provider 指向的 Subnet；若刚创建请点击工具栏刷新。">
              暂无同名子网
            </Tooltip>
          );
        }
        const ann = linked?.metadata?.annotations || {};
        const alias = String(ann[TOWER_ALIAS_ANNOTATION] || '').trim();
        const st = String(ann[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
        const typeLabel = subnetTypeToShortLabel(st);
        const cidr = String(linked?.spec?.cidrBlock ?? linked?.spec?.cidr ?? '').trim();
        const resName = linked?.metadata?.name || linked?.name || '';
        const line1 = alias || resName || '（无显示名）';
        const tip = [`子网名: ${line1}`, `类型: ${typeLabel || '—'}`, `网段: ${cidr || '—'}`].join('\n');
        const text = [line1, typeLabel || '—', cidr || '—'].join(' / ');
        return <Tooltip title={tip}>{text}</Tooltip>;
      },
    },
    {
      title: 'CNI版本',
      key: 'cni',
      render: (_: unknown, r: ProcessedNadRecord) => r._cniVersion || '-',
    },
    {
      title: 'UID',
      key: 'uid',
      render: (_: unknown, r: ProcessedNadRecord) => r?.metadata?.uid || '-',
    },
    {
      title: '创建时间',
      key: 'createdAt',
      ellipsis: true,
      render: (_: unknown, r: ProcessedNadRecord) => {
        const t = String(r._creationTimestamp || '').trim();
        if (!t) return '-';
        return new Date(t).toLocaleString();
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r: ProcessedNadRecord) => {
        const isPublic = isPublicNamespace(r._namespace);
        const deleteDisabled = isTenant && isPublic;
        const showDelete = !(isKubeOvnCniNad(r) && hasLinkedKubeOvnSubnetInMap(r, subnetByNameLc));
        const items: Array<
          | { key: string; label: string; onClick: () => void }
          | { type: 'divider' }
          | { key: string; label: string; danger: boolean; disabled: boolean; onClick: () => void }
        > = [];
        items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => onOpenYaml(r) });
        if (showDelete) items.push({ type: 'divider' });
        if (showDelete) {
          items.push({
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: deleteDisabled,
            onClick: () => onDelete(r),
          });
        }
        if (items.length === 0) {
          return '—';
        }
        return <ResourceActionsDropdown items={filterMenuItemsForReadOnly(items as any[], hasNadsWrite)} />;
      },
    },
  ];
}
