# 虚拟机启动失败诊断指南

## 问题描述
虚拟机 `lxc-xinference` 在 `default` 命名空间中无法启动，状态为 `Starting`，但 `Ready` 条件为 `False`，原因是 `GuestNotRunning`。

## 诊断方法

### 方法一：通过 API 查询（推荐）

如果您有 API 访问权限，可以通过以下 API 端点查询详细信息：

#### 1. 查询虚拟机实例 (VMI) 状态
```bash
# 替换 <cloudId> 为您的云资源池 ID
# 替换 <token> 为您的认证令牌
curl -H "Authorization: Bearer <token>" \
  "http://your-api-host/api/clouds/<cloudId>/monitoring/virtualmachineinstances" \
  | jq '.data[] | select(.metadata.name=="lxc-xinference")'
```

#### 2. 查询虚拟机事件
```bash
# 查询 VirtualMachineInstance 的事件（最有用）
curl -H "Authorization: Bearer <token>" \
  "http://your-api-host/api/clouds/<cloudId>/logging/harvester/events?namespace=default&name=lxc-xinference&kind=VirtualMachineInstance" \
  | jq '.data[] | {type, reason, message, lastTimestamp}'
```

#### 3. 查询 Pod 状态（virt-launcher）
```bash
# 查找 virt-launcher pod
curl -H "Authorization: Bearer <token>" \
  "http://your-api-host/api/clouds/<cloudId>/logging/harvester/vm-pod?namespace=default&vmName=lxc-xinference" \
  | jq '.'
```

### 方法二：通过 kubectl 直接查询（如果有集群访问权限）

如果您可以直接访问 Kubernetes 集群，可以使用以下命令：

#### 1. 查看 VMI 详细状态
```bash
kubectl get vmi lxc-xinference -n default -o yaml
kubectl describe vmi lxc-xinference -n default
```

#### 2. 查看相关事件
```bash
# 查看 VMI 事件
kubectl get events -n default --field-selector involvedObject.name=lxc-xinference,involvedObject.kind=VirtualMachineInstance --sort-by='.lastTimestamp'

# 查看 Pod 事件
kubectl get events -n default --field-selector involvedObject.kind=Pod --sort-by='.lastTimestamp' | grep lxc-xinference
```

#### 3. 查看 virt-launcher Pod 状态
```bash
# 查找 pod
kubectl get pods -n default | grep lxc-xinference

# 查看 pod 详细信息
kubectl describe pod virt-launcher-lxc-xinference-<random> -n default

# 查看 pod 日志
kubectl logs virt-launcher-lxc-xinference-<random> -n default
```

#### 4. 检查节点资源
```bash
# 检查节点标签（节点亲和性要求）
kubectl get nodes --show-labels | grep jiqun

# 检查节点资源
kubectl describe nodes | grep -A 10 "Allocated resources"
```

#### 5. 检查 PVC 状态
```bash
kubectl get pvc lxc-xinference-disk-2-pxnrw -n default
kubectl describe pvc lxc-xinference-disk-2-pxnrw -n default
```

## 常见问题及解决方案

### 1. 节点亲和性不满足（最可能）

**问题**：配置要求节点必须有 `network.harvesterhci.io/jiqun=true` 标签

**检查方法**：
```bash
kubectl get nodes --show-labels | grep jiqun
```

**解决方案**：
- 如果没有节点有该标签，需要给节点添加标签：
  ```bash
  kubectl label nodes <node-name> network.harvesterhci.io/jiqun=true
  ```
- 或者修改虚拟机的节点亲和性配置，移除该要求

### 2. 资源不足

**问题**：虚拟机需要 8 CPU cores 和 21845Mi 内存，但节点资源不足

**检查方法**：
```bash
kubectl describe nodes | grep -A 5 "Allocated resources"
```

**解决方案**：
- 释放其他虚拟机的资源
- 添加更多节点
- 降低虚拟机的资源请求

### 3. PVC 未绑定

**问题**：PVC `lxc-xinference-disk-2-pxnrw` 可能不存在或未绑定到 PV

**检查方法**：
```bash
kubectl get pvc lxc-xinference-disk-2-pxnrw -n default
```

**解决方案**：
- 如果 PVC 不存在，需要创建它
- 如果 PVC 处于 Pending 状态，检查存储类配置和存储容量

### 4. Multus 网络配置问题

**问题**：Multus 网络 `default/test` 可能不存在或配置错误

**检查方法**：
```bash
kubectl get network-attachment-definition test -n default
```

**解决方案**：
- 如果网络不存在，需要创建 Multus 网络配置
- 检查网络配置是否正确

### 5. IP 地址池耗尽（最常见）

**问题**：Calico IP 地址池已用完，无法为新 Pod 分配 IP 地址

**错误信息**：
```
FailedCreatePodSandBox: failed to allocate for range 0: no IP addresses available in range set: 10.52.0.1-10.52.0.254
```

**检查方法**：
```bash
# 检查 Calico IPPool 使用情况
kubectl get ippool -A -o yaml

# 检查 IP 地址分配情况
kubectl get pods -A -o wide | wc -l  # 统计 Pod 数量

# 检查 Calico 节点状态
kubectl get nodes -o wide
```

**解决方案**：

1. **扩大 IP 地址池范围**（推荐）：
   ```bash
   # 编辑 Calico IPPool
   kubectl edit ippool default-ipv4-ippool
   # 修改 CIDR 为更大的地址段，例如从 /24 改为 /22
   ```

2. **清理未使用的 Pod**：
   ```bash
   # 查找并删除已停止的 Pod
   kubectl get pods -A --field-selector=status.phase!=Running
   kubectl delete pod <pod-name> -n <namespace>
   ```

3. **检查 IP 地址泄漏**：
   ```bash
   # 检查是否有 Pod 已删除但 IP 未释放
   # 重启 Calico 节点代理（calico-node）
   kubectl delete pod -n kube-system -l k8s-app=calico-node
   ```

4. **添加新的 IPPool**：
   ```bash
   # 创建新的 IPPool 补充地址空间
   kubectl apply -f - <<EOF
   apiVersion: projectcalico.org/v3
   kind: IPPool
   metadata:
     name: additional-ippool
   spec:
     cidr: 10.53.0.0/24
     ipipMode: Never
     natOutgoing: true
   EOF
   ```

### 5.1. GPU 挂载导致 IP 地址池耗尽（特殊场景）

**问题描述**：
当虚拟机挂载 GPU 后，会出现 Calico IP 地址池用完的错误，但移除 GPU 后可以正常运行。所有配置都没变，都在同一节点。

**根本原因分析**：

GPU 挂载导致 IP 地址池耗尽的可能原因：

1. **GPU 设备插件创建额外 Pod**：
   - NVIDIA Device Plugin 或其他 GPU 设备管理组件可能创建额外的 DaemonSet Pod
   - 这些 Pod 需要从 Calico IPPool 分配 IP 地址
   - 如果 IPPool 已经接近饱和，新增的 Pod 就会导致地址池耗尽

2. **virt-launcher Pod 的网络配置变化**：
   - GPU 挂载可能导致 virt-launcher Pod 需要额外的网络接口或 sidecar 容器
   - 某些 GPU 管理组件可能需要额外的网络命名空间或 CNI 接口
   - 每个网络接口都需要从 IPPool 分配 IP 地址

3. **节点调度变化**：
   - GPU 挂载可能导致虚拟机被调度到不同的节点（GPU 节点）
   - 不同节点上的 Calico IPPool 使用情况可能不同
   - GPU 节点上可能已经有更多 Pod 占用了 IP 地址

4. **Multus 网络接口增加**：
   - GPU 挂载可能触发额外的 Multus 网络接口创建
   - 每个 Multus 网络接口都需要独立的 IP 地址
   - 如果配置了多个网络接口，会消耗更多 IP 地址

**诊断步骤**：

1. **对比 GPU 挂载前后的 Pod 数量**：
   ```bash
   # 挂载 GPU 前，记录 Pod 数量
   kubectl get pods -A --field-selector=status.phase=Running -o wide | wc -l
   
   # 挂载 GPU 后，再次统计
   kubectl get pods -A --field-selector=status.phase=Running -o wide | wc -l
   
   # 查看新增的 Pod
   kubectl get pods -A -o wide | grep -E "nvidia|gpu|device"
   ```

2. **检查 virt-launcher Pod 的网络接口**：
   ```bash
   # 查找 virt-launcher Pod
   kubectl get pods -n <namespace> | grep virt-launcher
   
   # 查看 Pod 的网络配置
   kubectl get pod <virt-launcher-pod-name> -n <namespace> -o yaml | grep -A 20 "annotations"
   
   # 检查是否有额外的网络接口
   kubectl exec -n <namespace> <virt-launcher-pod-name> -- ip addr show
   ```

3. **检查 Calico IPPool 使用情况**：
   ```bash
   # 查看 IPPool 配置
   kubectl get ippool -o yaml
   
   # 检查已分配的 IP 地址数量
   kubectl get pods -A -o jsonpath='{range .items[*]}{.status.podIP}{"\n"}{end}' | grep -v "^$" | wc -l
   
   # 查看 IPPool 的 CIDR 范围
   kubectl get ippool default-ipv4-ippool -o jsonpath='{.spec.cidr}'
   ```

4. **检查节点上的 Pod 分布**：
   ```bash
   # 查看 GPU 节点上的 Pod 数量
   kubectl get pods -A -o wide --field-selector spec.nodeName=<gpu-node-name> | wc -l
   
   # 对比非 GPU 节点
   kubectl get pods -A -o wide --field-selector spec.nodeName=<non-gpu-node-name> | wc -l
   ```

5. **检查 GPU 设备插件**：
   ```bash
   # 查找 NVIDIA Device Plugin Pod
   kubectl get pods -n kube-system | grep nvidia
   
   # 查看 Device Plugin 的配置
   kubectl get daemonset -n kube-system | grep nvidia
   ```

**解决方案**：

1. **扩大 Calico IPPool 地址范围**（最直接有效）：
   ```bash
   # 编辑 IPPool，将 CIDR 从 /24 扩大到 /22 或更大
   kubectl edit ippool default-ipv4-ippool
   
   # 例如：将 10.52.0.0/24 (254个地址) 改为 10.52.0.0/22 (1022个地址)
   # 修改 spec.cidr 字段
   ```

2. **添加新的 IPPool**（推荐用于生产环境）：
   ```bash
   kubectl apply -f - <<EOF
   apiVersion: projectcalico.org/v3
   kind: IPPool
   metadata:
     name: gpu-ippool
   spec:
     cidr: 10.53.0.0/24
     ipipMode: Never
     natOutgoing: true
     nodeSelector: "has(gpu)"  # 可选：仅用于 GPU 节点
   EOF
   ```

3. **清理未使用的 Pod 和 IP 地址**：
   ```bash
   # 查找并删除已停止的 Pod
   kubectl get pods -A --field-selector=status.phase!=Running
   kubectl delete pod <pod-name> -n <namespace>
   
   # 重启 Calico 节点代理以释放泄漏的 IP
   kubectl delete pod -n kube-system -l k8s-app=calico-node
   ```

4. **优化 GPU 节点上的 Pod 分布**：
   ```bash
   # 如果 GPU 节点上 Pod 过多，考虑将非 GPU 相关 Pod 调度到其他节点
   # 使用节点选择器或污点/容忍度来控制 Pod 调度
   ```

5. **检查并优化 Multus 网络配置**：
   ```bash
   # 如果虚拟机配置了多个 Multus 网络接口，评估是否都需要
   # 减少不必要的网络接口可以节省 IP 地址
   kubectl get network-attachment-definition -A
   ```

**预防措施**：

1. **提前规划 IP 地址池大小**：
   - 根据集群规模（节点数、Pod 数量）合理规划 IPPool 大小
   - 考虑 GPU 节点可能需要的额外 IP 地址
   - 建议预留 20-30% 的 IP 地址余量

2. **监控 IPPool 使用情况**：
   ```bash
   # 创建监控脚本定期检查 IPPool 使用率
   #!/bin/bash
   TOTAL=$(kubectl get ippool default-ipv4-ippool -o jsonpath='{.spec.cidr}' | awk -F'/' '{print 2^($2-2)}')
   USED=$(kubectl get pods -A -o jsonpath='{range .items[*]}{.status.podIP}{"\n"}{end}' | grep -v "^$" | wc -l)
   RATE=$(echo "scale=2; $USED*100/$TOTAL" | bc)
   echo "IPPool 使用率: $RATE% ($USED/$TOTAL)"
   ```

3. **使用节点亲和性和污点**：
   - 为 GPU 节点设置污点，避免非 GPU Pod 调度到 GPU 节点
   - 这样可以减少 GPU 节点上的 IP 地址消耗

### 6. VMI 调度失败

**问题**：VMI 无法被调度到任何节点

**检查方法**：
```bash
kubectl get vmi lxc-xinference -n default -o yaml | grep -A 20 "conditions"
```

**解决方案**：
- 查看 VMI 的 conditions 字段，找到具体的调度失败原因
- 根据错误信息调整配置

## 快速诊断脚本

创建一个诊断脚本 `diagnose-vm.sh`：

```bash
#!/bin/bash

VM_NAME="lxc-xinference"
NAMESPACE="default"

echo "=== 虚拟机诊断报告 ==="
echo "虚拟机名称: $VM_NAME"
echo "命名空间: $NAMESPACE"
echo ""

echo "1. 检查 VM 状态..."
kubectl get vm $VM_NAME -n $NAMESPACE -o yaml | grep -A 5 "status:"

echo ""
echo "2. 检查 VMI 状态..."
kubectl get vmi $VM_NAME -n $NAMESPACE -o yaml | grep -A 10 "status:"

echo ""
echo "3. 检查 VMI 事件..."
kubectl get events -n $NAMESPACE --field-selector involvedObject.name=$VM_NAME,involvedObject.kind=VirtualMachineInstance --sort-by='.lastTimestamp' | tail -20

echo ""
echo "4. 检查 Pod 状态..."
kubectl get pods -n $NAMESPACE | grep $VM_NAME

echo ""
echo "5. 检查节点标签..."
kubectl get nodes --show-labels | grep jiqun

echo ""
echo "6. 检查 PVC 状态..."
kubectl get pvc -n $NAMESPACE | grep $VM_NAME

echo ""
echo "7. 检查 Multus 网络..."
kubectl get network-attachment-definition -n $NAMESPACE
```

## 根据配置文件分析的可能原因

根据您提供的配置文件 `3.md` 和实际错误信息，**最可能的原因是 IP 地址池耗尽**：

### ⚠️ 当前问题：IP 地址池耗尽（已确认）

**错误信息**：
- `FailedCreatePodSandBox`
- `no IP addresses available in range set: 10.52.0.1-10.52.0.254`

**解决方案**：
1. 立即扩大 Calico IPPool 的地址范围
2. 清理未使用的 Pod 释放 IP 地址
3. 检查是否有 IP 地址泄漏

### 其他可能原因（按优先级）：

1. **节点亲和性不满足**
   - 配置要求：`network.harvesterhci.io/jiqun=true`
   - 如果没有符合条件的节点，VMI 无法调度

2. **资源不足**
   - CPU 请求：8 cores
   - 内存请求：21845Mi (~21.3Gi)
   - 检查节点是否有足够资源

3. **PVC 问题**
   - PVC 名称：`lxc-xinference-disk-2-pxnrw`
   - 检查 PVC 是否存在且已绑定

建议优先检查节点亲和性和资源情况，这两个是最常见的启动失败原因。
