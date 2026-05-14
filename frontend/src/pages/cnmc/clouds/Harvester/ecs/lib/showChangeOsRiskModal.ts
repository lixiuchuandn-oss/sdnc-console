import React from "react";
import { Modal } from "antd";
import type { FormInstance } from "antd/es/form";

/** 与资源变配「更换系统镜像」一致：弹窗说明风险并在确认后勾选表单 `changeOsConfirmed`。 */
export function showChangeOsRiskModal(form: FormInstance<any>): void {
  Modal.info({
    title: "更换系统盘风险说明",
    width: 520,
    content: React.createElement(
      "div",
      { style: { marginTop: 8, fontSize: 13, lineHeight: 1.6 } },
      React.createElement(
        "p",
        { style: { marginBottom: 4 } },
        "• 更换操作系统将删除当前的系统盘并重建实例，系统盘数据将会丢失。",
      ),
      React.createElement(
        "p",
        { style: { marginBottom: 4 } },
        "• 挂载的数据盘将被保留，但在新系统启动后可能需要手动重新挂载。",
      ),
      React.createElement(
        "p",
        { style: { marginBottom: 0 } },
        "• 虚拟机将会强制重启以应用更改，请在业务低峰期执行。",
      ),
    ),
    okText: "我已知晓",
    onOk: () => {
      try {
        form.setFieldsValue({ changeOsConfirmed: true });
      } catch {
        /* ignore */
      }
    },
  });
}
