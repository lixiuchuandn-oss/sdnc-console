/**
 * 详情内嵌「次级查看类」抽屉共用壳：与 VmSpecConfigDrawer / VmDiskManageDrawer 对齐
 * （closable=false、body padding 24、push、底部「关闭」；默认无正文标题行，与「调整规格」一致）。
 */
import React from "react";
import { Button, Drawer, Space } from "antd";
import { useVmManageDrawerCssVars } from "../lib/useVmManageDrawerCssVars";
import "../styles/vmManageDrawer.css";

function drawerHeadNodePresent(n: React.ReactNode | undefined): boolean {
  if (n === undefined || n === null || n === false) return false;
  if (typeof n === "string") return n.trim().length > 0;
  return true;
}

export type VmSecondaryDrawerShellProps = {
  open: boolean;
  onClose: () => void;
  /** 可选；不传则不渲染 vmManageDrawer-pageHead（与 VmSpecConfigDrawer 一致） */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 正文是否纵向铺满可视区（Tabs / 终端日志等）；默认 false 与「调整规格」一致随 Drawer 滚动 */
  fillViewport?: boolean;
  footerExtra?: React.ReactNode;
  forceRender?: boolean;
  destroyOnClose?: boolean;
  destroyOnHidden?: boolean;
  zIndex?: number;
  push?: boolean | { distance: number };
  children: React.ReactNode;
};

const VmSecondaryDrawerShell: React.FC<VmSecondaryDrawerShellProps> = ({
  open,
  onClose,
  title,
  subtitle,
  fillViewport = false,
  footerExtra,
  /** 默认 false：避免强制渲染打断 Drawer 离场动画（与嵌套 push 对齐） */
  forceRender = false,
  destroyOnClose,
  destroyOnHidden,
  zIndex = 1100,
  push = { distance: 180 },
  children,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();

  const showPageHead =
    drawerHeadNodePresent(title) || drawerHeadNodePresent(subtitle);

  const bodyStyle: React.CSSProperties = fillViewport
    ? {
        padding: 24,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }
    : { padding: 24 };

  const innerWrapStyle: React.CSSProperties = fillViewport
    ? {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }
    : {};

  return (
    <Drawer
      closable={false}
      width={800}
      placement="right"
      open={open}
      onClose={onClose}
      forceRender={forceRender}
      zIndex={zIndex}
      push={push}
      destroyOnClose={destroyOnClose}
      destroyOnHidden={destroyOnHidden}
      styles={{
        header: { display: "none" },
        body: bodyStyle,
      }}
      footer={
        <Space style={{ width: "100%", justifyContent: "flex-end" }} wrap>
          {footerExtra}
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <div
        className="vmManageDrawer vmSecondaryDrawer"
        style={{
          ...vmManageCssVars,
          ...(fillViewport
            ? {
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }
            : {}),
        }}
      >
        {showPageHead ? (
          <div className="vmManageDrawer-pageHead">
            <div className="vmManageDrawer-pageHead-row">
              <div className="vmManageDrawer-pageHead-titleWrap">
                {drawerHeadNodePresent(title) ? (
                  <div className="vmManageDrawer-pageHead-main">{title}</div>
                ) : null}
                {drawerHeadNodePresent(subtitle) ? (
                  <div className="vmManageDrawer-pageHead-sub">{subtitle}</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {fillViewport ? (
          <div className="vmSecondaryDrawer-bodyFill" style={innerWrapStyle}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </Drawer>
  );
};

export default VmSecondaryDrawerShell;
