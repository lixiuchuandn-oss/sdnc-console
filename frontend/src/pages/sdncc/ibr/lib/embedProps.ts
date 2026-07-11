/** 网际路由域详情 · IBR 管理 Tab / Tower iframe 嵌入时的公共参数 */
export type IbrSectionEmbedProps = {
  /** 嵌入详情 Tab 或 Tower iframe：隐藏 PageContainer 页头，收紧边距 */
  embedded?: boolean;
  /** 仅展示与该 VR UUID 关联的资源（网际路由域已绑定的 IBR） */
  scopedVrUuid?: string;
  /** Tower 传入的租户上下文（iframe query `tenant_id`） */
  tenantId?: string;
  organizationId?: string;
};
