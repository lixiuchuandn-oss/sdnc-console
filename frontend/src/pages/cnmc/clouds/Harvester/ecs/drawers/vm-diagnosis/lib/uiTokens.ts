/**
 * 诊断抽屉专用 UI 常量（不依赖 vm-detail，避免耦合）
 */
import type { CSSProperties } from "react";

/** 次要/说明文案色，对齐 Ant Design 次级文本 */
export const VM_DIAGNOSIS_TEXT_SECONDARY = "rgba(0, 0, 0, 0.45)";

/** 主内容纵向区块间距（px） */
export const VM_DIAGNOSIS_SECTION_GAP = 32;

/** 步骤内卡片：边框、浅底 */
export const DIAG_STEP_CONTENT_CARD = {
  variant: "borderless" as const,
  styles: { body: { padding: 0 } },
  style: {
    borderRadius: 8,
    border: "1px solid #f0f0f0",
    background: "#fafafa",
  },
};

/** Descriptions 内边距 */
export const DIAG_DESC_INNER: CSSProperties = { padding: "12px 16px" };

/** 页面级外壳（步骤条容器） */
export const DIAG_PAGE_SHELL_STYLE: CSSProperties = {
  borderRadius: 8,
  border: "1px solid #f0f0f0",
  background: "#fff",
};

/** 节点资源检查中单节点块 */
export function diagNodeResourceBlock(sufficient: boolean): CSSProperties {
  return {
    padding: "12px 16px",
    borderRadius: 8,
    background: sufficient ? "#f6ffed" : "#fff1f0",
    border: `1px solid ${sufficient ? "#b7eb8f" : "#ffccc7"}`,
  };
}
