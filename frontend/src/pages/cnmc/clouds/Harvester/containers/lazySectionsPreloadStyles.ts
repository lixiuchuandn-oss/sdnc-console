/**
 * 容器 Section 懒加载后，异步 chunk 内 CSS 注入顺序不稳定会导致 CI 下
 * mini-css-extract-plugin「Conflicting order」构建失败。在此按固定顺序预加载相关样式。
 */
import 'reactflow/dist/style.css';
import 'xterm/css/xterm.css';
import '../ecs/modals/VmCreateWizard/InstanceWizard.css';
import './components/topology/ServiceTopology.css';
import './components/topology/TopologyNodeStyles.css';
