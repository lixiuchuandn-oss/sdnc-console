import React from "react";
import { Empty } from "antd";

type VmDeviceManageDrawerEmptyProps = {
  description: string;
};

/** 磁盘 / 网卡 / GPU / USB 等资源管理抽屉 · 列表为空时的统一简易空状态 */
const VmDeviceManageDrawerEmpty: React.FC<VmDeviceManageDrawerEmptyProps> = ({
  description,
}) => (
  <div className="vmDeviceManageDrawer-emptyState">
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />
  </div>
);

export default VmDeviceManageDrawerEmpty;
