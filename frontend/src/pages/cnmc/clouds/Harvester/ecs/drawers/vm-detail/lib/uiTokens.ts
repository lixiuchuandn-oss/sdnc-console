/**
 * 虚拟机详情抽屉 · 设计 token（色值、弱边框等），供主抽屉 / tabs / 二级抽屉共用。
 * 非 CSS 样式表；页面级布局仍以各组件内联或独立 .css 为准。
 */
import type { CSSProperties } from "react";

/** 次要/说明类文案（统一灰字，对齐 Ant Design 描述色） */
export const VM_DETAIL_DRAWER_TEXT_SECONDARY = "rgba(0, 0, 0, 0.45)";

/** 列表内弱分隔（|）等 */
export const VM_DETAIL_DRAWER_TEXT_SPLIT = "rgba(0, 0, 0, 0.25)";

/** 虚线下划线等弱边框 */
export const VM_DETAIL_DRAWER_BORDER_MUTED = "rgba(0, 0, 0, 0.25)";

/** 详情抽屉 Tab 主内容区纵向区块间距（px） */
export const VM_DETAIL_DRAWER_TAB_SECTION_GAP = 32;

/** 业务块 Card 描边/圆角；阴影由 antd borderless Card 的 boxShadowTertiary 提供 */
export const VM_DETAIL_DRAWER_BLOCK_CARD_STYLE: CSSProperties = {
  border: "1px solid #e0e0e0",
  borderRadius: 8,
};

/** 详情 Tab 各业务块 Card：浅灰底、无边框与投影（仅 VmDetailTab） */
export const VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE: CSSProperties = {
  background: "#f5f5f5",
  border: "none",
  borderRadius: 8,
  boxShadow: "none",
};

/** 详情 Tab 内横向/纵向结构分隔线（与 List split、Progress 轨道统一） */
export const VM_DETAIL_DRAWER_DETAIL_TAB_DIVIDER_COLOR = "#e0e0e0";

/** 详情 Tab 单列 Descriptions（节点调度、其他选项）：标签列宽与标签/值列间距统一 */
export const VM_DETAIL_DRAWER_DETAIL_TAB_DESCRIPTIONS_STYLES: {
  label: CSSProperties;
  content: CSSProperties;
} = {
  label: {
    width: 140,
    minWidth: 140,
    maxWidth: 140,
    boxSizing: "border-box",
    color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
    paddingInlineEnd: 16,
    verticalAlign: "top",
  },
  content: {
    verticalAlign: "top",
    paddingInlineStart: 8,
  },
};

/** Card 上方区块标题行：固定 24px 行盒，避免「仅标题」与「标题 + link」高低不一致 */
export const VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  minHeight: 24,
  marginBottom: 4,
};

/** 区块标题主文案：仅次要色，字号行高继承父级 */
export const VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE: CSSProperties = {
  color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
};

/** 标题行右侧 link：仅压缩内边距与高度，不改字号 */
export const VM_DETAIL_DRAWER_SECTION_TITLE_LINK_BTN_STYLE: CSSProperties = {
  padding: 0,
  height: 24,
};

/** Cloud-Init「配置卷」等小标题（沿用原稿字重与间距） */
export const VM_DETAIL_DRAWER_SUBSECTION_HEADING_STYLE: CSSProperties = {
  fontWeight: 500,
  marginBottom: 6,
};

/** 模板内联等次要说明行：仅色与下边距 */
export const VM_DETAIL_DRAWER_SUBSECTION_MUTED_LABEL_STYLE: CSSProperties = {
  color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
  marginBottom: 6,
};
