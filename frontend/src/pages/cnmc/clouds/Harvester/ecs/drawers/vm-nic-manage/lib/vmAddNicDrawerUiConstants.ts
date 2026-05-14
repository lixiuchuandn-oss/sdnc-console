/** 添加网卡抽屉共用：模型 Segmented 选项等（避免在多个抽屉里复制常量）。 */
export const VM_ADD_NIC_MODEL_OPTIONS = [
  { label: "virtio", value: "virtio" },
  { label: "e1000", value: "e1000" },
  { label: "e1000e", value: "e1000e" },
  { label: "rtl8139", value: "rtl8139" },
];

export const VM_ADD_NIC_MAC_RULE = {
  pattern: /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/,
  message: "格式如 52:54:00:12:34:56",
};

export const VM_ADD_NIC_STATIC_IP_RULE = {
  pattern:
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/,
  message: "格式如 192.168.1.23",
};

/** 子网网段只读框：无数据时的占位（避免用「—」）。 */
export const VM_ADD_NIC_SUBNET_CIDR_PLACEHOLDER = "选择子网后将显示网段";
