/** `AdminLayout` 通过 `<Outlet context={...} />` 向子路由暴露的上下文 */
export type AdminLayoutOutletContext = {
  reloadSummaryClouds: () => void | Promise<void>;
};
