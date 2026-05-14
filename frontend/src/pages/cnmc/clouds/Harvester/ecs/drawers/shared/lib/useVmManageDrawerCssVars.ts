import { useMemo } from "react";
import { theme } from "antd";
import type { CSSProperties } from "react";

/**
 * 将 Ant Design token 写到 `.vmManageDrawer` 根节点的 CSS 变量上，
 * 供 `drawers/shared/styles/vmManageDrawer.css` 使用（静态 CSS 无法读取未开启的 `theme.cssVar` 全局 `--ant-*`）。
 */
export function useVmManageDrawerCssVars(): CSSProperties {
  const { token } = theme.useToken();
  return useMemo(
    () =>
      ({
        "--vm-manage-color-text": token.colorText,
        "--vm-manage-color-text-secondary": token.colorTextSecondary,
        "--vm-manage-color-text-tertiary": token.colorTextTertiary,
        "--vm-manage-color-text-quaternary": token.colorTextQuaternary,
        "--vm-manage-color-bg-container": token.colorBgContainer,
        "--vm-manage-border-radius-lg": `${token.borderRadiusLG}px`,
        "--vm-manage-color-border-secondary": token.colorBorderSecondary,
        "--vm-manage-color-primary": token.colorPrimary,
        "--vm-manage-color-fill-alter": token.colorFillAlter,
        "--vm-manage-color-fill-secondary": token.colorFillSecondary,
        "--vm-manage-color-fill-quaternary": token.colorFillQuaternary,
        "--vm-manage-color-split": token.colorSplit,
        "--vm-manage-box-shadow-tertiary": token.boxShadowTertiary,
      }) as CSSProperties,
    [token],
  );
}
