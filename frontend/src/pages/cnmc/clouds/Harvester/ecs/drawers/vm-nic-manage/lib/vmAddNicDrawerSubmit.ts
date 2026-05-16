/**
 * 添加辅助网卡：合并主网卡表单 + 现有辅卡 + 新一行，调用 computeSecondaryNicsPayload 并 PATCH。
 */
import yaml from "js-yaml";
import { message } from "antd";
import { updateHarvesterVmSpec } from "../../../../../../../../services/harvesterApi";
import { getMissingNadsFromNetworks } from "../../../lib/harvesterVmNetwork";
import {
  buildPrimaryNicFormSlice,
  buildSecondaryNicsFormSlicesFromRecord,
} from "./networkNicsForm";
import {
  parseVmCloudInitNetworkData,
  generateMacAddressForStaticNic,
} from "../../../lib/vmMutation/vmReconfigureCloudInit";
import { computeSecondaryNicsPayload } from "./vmNicReconfigureCompute";
import { buildKubeOvnCustomIpVmMetadataAnnotationsFromReconfigureForm } from "../../../lib/vmNicManageLogic";
import {
  getVmTemplateFixedHostname,
  validateAppendPassthroughPciNodeAffinity,
} from "../../../lib/passthroughNicSelectOptions";
import { showVmNicChangeRestartConfirm } from "./vmNicSaveRestartConfirm";

function mergeHarvesterDeviceAllocationDetailsJson(
  vmData: any,
  pciCrName: string,
  pciResourceName: string,
): string {
  let hostdevices: Record<string, string[]> = {};
  try {
    const raw = vmData?.metadata?.annotations?.["harvesterhci.io/deviceAllocationDetails"];
    if (raw) {
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (p?.hostdevices && typeof p.hostdevices === "object") {
        hostdevices = JSON.parse(JSON.stringify(p.hostdevices));
      }
    }
  } catch {
    /* ignore */
  }
  const r = String(pciResourceName).trim();
  const c = String(pciCrName).trim();
  if (!r || !c) return JSON.stringify({ hostdevices });
  if (!hostdevices[r]) hostdevices[r] = [];
  if (!hostdevices[r].includes(c)) hostdevices[r].push(c);
  return JSON.stringify({ hostdevices });
}

export async function submitAppendSecondaryNicRow(opts: {
  cloudId: string;
  vmData: any;
  newRow: Record<string, unknown>;
  subnets: any[];
  nads: any[];
  vmNs: string;
  vmName: string;
  pciDevices?: any[];
}): Promise<void> {
  const { cloudId, vmData, newRow, subnets, nads, vmNs, vmName, pciDevices } = opts;
  const primaryPatch = buildPrimaryNicFormSlice(vmData, subnets);
  const secondaries = [
    ...buildSecondaryNicsFormSlicesFromRecord(vmData, subnets),
    newRow,
  ];
  const values = { ...primaryPatch, secondaryNics: secondaries };
  const computed = computeSecondaryNicsPayload(
    vmData,
    values,
    subnets,
    nads,
    parseVmCloudInitNetworkData,
    generateMacAddressForStaticNic,
  );
  if (!computed) {
    message.error("无法计算网卡配置（请检查虚拟机网卡与表单数据是否有效）");
    throw new Error("compute_secondary_nic_failed");
  }
  const payload: any = {
    networks: computed.networks,
    interfaces: computed.interfaces,
    vmMetadataAnnotations: buildKubeOvnCustomIpVmMetadataAnnotationsFromReconfigureForm(
      values,
      subnets,
      nads,
    ),
  };
  if (computed.hasNetworkDataChange) {
    payload.networkData = yaml.dump(computed.networkDataObj);
  }

  const isPciPass =
    String(newRow?.passthroughSource || "") === "pci-host" &&
    String(newRow?.pciDeviceName || "").trim() &&
    String(newRow?.pciResourceName || "").trim();
  if (isPciPass) {
    const cr = String(newRow.pciDeviceName).trim();
    const rn = String(newRow.pciResourceName).trim();
    const pciNode = String(newRow?.pciNodeName || "").trim();
    const affinityErr = validateAppendPassthroughPciNodeAffinity({
      vm: vmData,
      pciNodeName: pciNode,
      bindNode: String(newRow?.passthroughBindNode || "").trim() || undefined,
      pciDevices,
    });
    if (affinityErr) {
      message.error(affinityErr);
      throw new Error("passthrough_pci_node_mismatch");
    }
    payload.appendHostDevices = [{ name: cr, deviceName: rn }];
    const ann = { ...payload.vmMetadataAnnotations } as Record<string, string | null>;
    ann["harvesterhci.io/deviceAllocationDetails"] = mergeHarvesterDeviceAllocationDetailsJson(
      vmData,
      cr,
      rn,
    );
    payload.vmMetadataAnnotations = ann;
    const fixedHost = getVmTemplateFixedHostname(vmData);
    if (pciNode && !fixedHost) {
      const cur = vmData?.spec?.template?.spec?.nodeSelector || {};
      payload.nodeSelector = {
        ...cur,
        "kubernetes.io/hostname": pciNode,
      };
    }
  }

  const missing = getMissingNadsFromNetworks(
    computed.networks,
    vmNs || "default",
    nads,
  );
  if (missing.length > 0) {
    message.error(
      `更新失败：引用的 NAD 不存在：${missing.join(", ")}。请更换为存在的网络后再提交。`,
    );
    throw new Error("missing_nad");
  }
  await updateHarvesterVmSpec(cloudId, vmNs, vmName, payload);
  message.success("辅助网卡已添加");
  showVmNicChangeRestartConfirm({ cloudId, vmNs, vmName, vmData });
}
