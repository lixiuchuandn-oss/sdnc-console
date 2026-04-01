# 公共子网（external）编辑与 ovn-internal VPC 联动 — 修改纪要
 
## 背景/目标
在“集群下的公共网络（公共子网）”进行编辑时，需要按以下顺序联动内置 VPC `ovn-internal`：
1. 先将 `ovn-internal` VPC 的 `spec.enableExternal` 设为 `false`
2. 再更新公共网络 `external` 的配置（公共子网 Subnet）
3. 更新完成后，将 `ovn-internal` VPC 的 `spec.enableExternal` 设回 `true`
4. 同时将 `ovn-internal` VPC 的 `spec.nextHopIP` 设置为公共网络 `external` 的网关地址（即编辑表单中的 gateway）
 
并新增限制：
- 若公共子网被 **非 lrp 类型** 的 EIP（OvnEip）引用，则禁止编辑保存，并提示用户先删除相关 EIP。
- 若仅被 **lrp 类型** EIP 引用，则允许编辑保存且不弹额外确认提示。
 
## 修改后的效果（用户可见）
### 1) 编辑公共网络 external 时自动处理 ovn-internal VPC
- 入口：公共子网列表（`mode=public`）里，点击某条记录的“编辑网络”并保存。
- 仅当满足以下条件时触发联动：
  - 当前列表为公共子网（`mode=public`）
  - 当前编辑的 Subnet `metadata.name === "external"`
  - 且该 Subnet 所属 `spec.vpc === "ovn-cluster"`
- 保存流程：
  - 先调用更新 VPC 接口，把 `ovn-internal` 的 `enableExternal=false`
  - 然后更新该公共子网的 Subnet
  - Subnet 更新成功后，再调用更新 VPC 接口，把 `ovn-internal` 的 `enableExternal=true`，并设置 `nextHopIP=公网 external 的 gateway`
- 权限要求：
  - 编辑公共网络 external 需要具备 VPC 写权限（`clouds.vpcs:write` 或 `clouds:write`），否则保存会被阻止并提示缺少权限。
 
### 2) 公共子网被 EIP 占用时的编辑限制
- 在保存前校验：按 `OvnEip.spec.externalSubnet === 当前子网名` 筛选“正在使用该公共子网”的 EIP。
- 规则：
  - 若存在任一 `type != lrp` 的 EIP 在使用：禁止编辑保存
  - 若只有 `type == lrp` 的 EIP 在使用：允许继续保存，不弹确认框
- 禁止保存提示文案：
  - `该公共子网正在被 EIP 使用，{EIP名称列表} 共 {n} 个，请先删除EIP后再修改`
 
### 3) 兼容后端不支持 PATCH 的情况
现网报错：`Cannot PATCH /api/clouds/{id}/resources/vpcs/ovn-internal`
原因：后端路由不支持 PATCH 方法（Express 默认返回 Cannot PATCH）。
处理：前端更新 VPC 时改为“先 PATCH，若遇到 Cannot PATCH/404 则自动降级为 PUT 重试”。
 
## 涉及文件
- [UnderlaySubnetsSection.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/UnderlaySubnetsSection.tsx)
- [harvesterApi.ts](file:///d:/work/Compute.Tower/frontend/src/services/harvesterApi.ts)
 
## 代码改动（完整列出本任务涉及的新增/修改代码）
 
### A) UnderlaySubnetsSection.tsx
#### A1. 新增/调整 import（与公共子网 + VPC 联动相关）
来源：[UnderlaySubnetsSection.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/UnderlaySubnetsSection.tsx#L1-L39)
```ts
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ApartmentOutlined, GlobalOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import {
  deleteKubeOvnSubnet,
  fetchCloudProviderOvnEips,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  updateKubeOvnSubnet,
  updateHarvesterVpc,
} from '../../../../services/harvesterApi';
import { clearCache } from '../../../../utils/requestManager';
import SubnetAclFormItems, {
  normalizeAclRowForForm,
  validateAclsFormRowsForSubmit,
} from './SubnetAclFormItems';
import UnderlaySubnetDetailDrawer from './UnderlaySubnetDetailDrawer';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
  CLOUD_SUBNETS_FLAT_WRITE,
  CLOUD_SUBNETS_PUBLIC_WRITE,
} from '../../../../constants/cloudPermissions';
import {
  CreateFlatSubnetModal,
  CreatePublicSubnetModal,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  UnderlaySubnetFormFields,
  vlanRecordLabelForSelect,
  vlanRecordSearchBlob,
} from './underlay-subnet';
```
 
#### A2. 增加 VPC 写权限判断（用于 external 编辑时联动 ovn-internal）
来源：[UnderlaySubnetsSection.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/UnderlaySubnetsSection.tsx#L90-L114)
```ts
  const hasVpcsWrite = useMemo(() => {
    const hasWrite =
      hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write');
    return hasWrite && !isTenantUser;
  }, [perms, isTenantUser]);
```
 
#### A3. 公共子网编辑保存逻辑：EIP 占用限制 + ovn-internal VPC 联动（enableExternal / nextHopIP）
来源：[UnderlaySubnetsSection.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/UnderlaySubnetsSection.tsx#L251-L363)
```ts
  const handleEdit = async (values: any) => {
    if (!ensureUnderlayWrite()) return;
    const name = editRecord?.metadata?.name;
    if (!name) return;
    let isEditingExternalPublic = false;
    let internalEnableExternalTouched = false;
    try {
      setEditSubmitting(true);
      if (!isFlatMode) {
        let usedEips: any[] = [];
        try {
          const eipRes = await fetchCloudProviderOvnEips(cloudId, true, 'legacy');
          const items = Array.isArray(eipRes?.data?.items) ? eipRes.data.items : [];
          usedEips = items.filter((e: any) => String(e?.spec?.externalSubnet ?? '').trim() === String(name).trim());
        } catch (e: any) {
          message.error(`校验公共子网 EIP 占用失败: ${e?.message || '未知错误'}`);
          return;
        }
        if (usedEips.length > 0) {
          const normType = (e: any) => String(e?.spec?.type ?? e?.type ?? '').trim().toLowerCase();
          const nonLrp = usedEips.filter((e) => normType(e) !== 'lrp');
          const lrpOnly = nonLrp.length === 0;
          if (!lrpOnly) {
            const names = nonLrp
              .slice(0, 5)
              .map((e) => String(e?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? e?.metadata?.name ?? '').trim())
              .filter(Boolean);
            const usageText =
              names.length > 0
                ? nonLrp.length > 5
                  ? `${names.join('、')} 等 ${nonLrp.length} 个`
                  : `${names.join('、')} 共 ${nonLrp.length} 个`
                : `共 ${nonLrp.length} 个`;
            message.error(`该公共子网正在被 EIP 使用，${usageText}，请先删除EIP后再修改`);
            return;
          }
        }
      }
      const { alias, ...rest } = values;
      const aliasTrim = String(alias ?? '').trim();
      const excludeIps = rest.excludeIps
        ? String(rest.excludeIps).split('\n').map((s: string) => s.trim()).filter((s: string) => s)
        : [];
      const annotations: Record<string, string> = {
        [TOWER_ALIAS_ANNOTATION]: aliasTrim,
      };
      const vpcName = String(editRecord?.spec?.vpc ?? editRecord?.vpc ?? '').trim();
      isEditingExternalPublic = !isFlatMode && String(name) === 'external' && vpcName === KUBE_OVN_PUBLIC_VPC;
      if (isEditingExternalPublic && !hasVpcsWrite) {
        message.error(
          '编辑公共网络 external 需要同时更新 ovn-internal VPC（enableExternal / nextHopIP），当前账号缺少 VPC 写权限',
        );
        return;
      }
      const payload: Record<string, unknown> = {
        cidrBlock: String(rest.cidrBlock ?? '').trim(),
        gateway: String(rest.gateway ?? '').trim(),
        excludeIps,
        annotations,
      };
      const vlanRaw = rest.vlan;
      if (vlanRaw !== undefined && vlanRaw !== null && String(vlanRaw) !== '') {
        payload.vlan = vlanRaw;
      } else {
        payload.vlan = null;
      }
      if (isEditingExternalPublic) {
        try {
          await updateHarvesterVpc(cloudId, KUBE_OVN_FLAT_VPC, { enableExternal: false });
          internalEnableExternalTouched = true;
        } catch (e: any) {
          message.error(`关闭 ovn-internal VPC enableExternal 失败: ${e?.message || '未知错误'}`);
          return;
        }
      }
      await updateKubeOvnSubnet(cloudId, name, payload);
      if (isEditingExternalPublic) {
        try {
          await updateHarvesterVpc(cloudId, KUBE_OVN_FLAT_VPC, {
            enableExternal: true,
            nextHopIP: String(rest.gateway ?? '').trim(),
          });
          internalEnableExternalTouched = false;
        } catch (e: any) {
          message.error(
            `公共网络已更新，但恢复 ovn-internal VPC enableExternal/nextHopIP 失败: ${e?.message || '未知错误'}`,
          );
        }
      }
      message.success(`更新${subnetKindLabel}成功`);
      setEditModalVisible(false);
      setEditRecord(null);
      editForm.resetFields();
      await fetchData(true, false);
    } catch (error: any) {
      if (isEditingExternalPublic && internalEnableExternalTouched) {
        try {
          await updateHarvesterVpc(cloudId, KUBE_OVN_FLAT_VPC, { enableExternal: true });
        } catch {}
      }
      const raw =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        error?.response?.data ??
        error?.data?.message ??
        error?.message ??
        '未知错误';
      const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      message.error(`更新${subnetKindLabel}失败: ${detail}`);
    } finally {
      setEditSubmitting(false);
    }
  };
```
 
### B) harvesterApi.ts
#### B1. updateHarvesterVpc：PATCH → PUT 自动降级
来源：[harvesterApi.ts](file:///d:/work/Compute.Tower/frontend/src/services/harvesterApi.ts#L44-L55)
```ts
export const updateHarvesterVpc = async (cloudId: string, name: string, payload: any) => {
  const path = `/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(name)}`;
  try {
    return await apiPatch(path, payload);
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (msg.includes('Cannot PATCH') || e?.status === 404) {
      return await apiPut(path, payload);
    }
    throw e;
  }
};
```
 
## 合入/验证要点
- 测试路径：
  - 公共子网列表（mode=public）→ 编辑 `external` → 保存：
    - 若被非 lrp EIP 占用：应直接阻止保存并提示先删 EIP
    - 若只被 lrp 占用或未占用：应正常保存
    - 保存过程中应先关闭 `ovn-internal.enableExternal`，再更新 Subnet，最后恢复并写入 `nextHopIP=gateway`
- 注意：
  - 本次对 VPC 更新增加了 PATCH→PUT 兼容逻辑，用于适配后端“不支持 PATCH”的部署形态。
