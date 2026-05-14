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

export async function submitAppendSecondaryNicRow(opts: {
  cloudId: string;
  vmData: any;
  newRow: Record<string, unknown>;
  subnets: any[];
  nads: any[];
  vmNs: string;
  vmName: string;
}): Promise<void> {
  const { cloudId, vmData, newRow, subnets, nads, vmNs, vmName } = opts;
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
    message.error("无法计算网卡配置（请确认虚拟机已有主网卡）");
    throw new Error("compute_secondary_nic_failed");
  }
  const payload: any = {
    networks: computed.networks,
    interfaces: computed.interfaces,
  };
  if (computed.hasNetworkDataChange) {
    payload.networkData = yaml.dump(computed.networkDataObj);
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
}
