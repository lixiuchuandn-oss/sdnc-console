/**
 * Cloudmap 资源池主内容区：侧栏 + URL `/:nav/:poolInnerSeg` + `innerActiveKey` 分支渲染。
 * 不使用 antd `<Tabs>`（Rancher 工作台等例外见 `rancher/pool/styles/rancher-workspace.css`）。
 */
export type CloudmapPoolRoutePanelBaseProps = {
  /** 路径末段 / 当前子菜单 key（如 `ecs`、`nodes`）。 */
  innerActiveKey: string;
};
