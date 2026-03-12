#!/bin/bash

# 虚拟机启动失败诊断脚本
# 使用方法: ./diagnose-vm.sh <vm-name> [namespace]

VM_NAME="${1:-lxc-xinference}"
NAMESPACE="${2:-default}"

echo "=========================================="
echo "  虚拟机启动失败诊断报告"
echo "=========================================="
echo "虚拟机名称: $VM_NAME"
echo "命名空间: $NAMESPACE"
echo "诊断时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 检查 kubectl 是否可用
if ! command -v kubectl &> /dev/null; then
    echo "错误: 未找到 kubectl 命令，请先安装 kubectl 并配置集群访问"
    exit 1
fi

# 检查命名空间是否存在
if ! kubectl get namespace $NAMESPACE &> /dev/null; then
    echo "错误: 命名空间 '$NAMESPACE' 不存在"
    exit 1
fi

echo "=========================================="
echo "1. 虚拟机 (VM) 状态"
echo "=========================================="
if kubectl get vm $VM_NAME -n $NAMESPACE &> /dev/null; then
    echo "VM 存在"
    echo ""
    echo "状态摘要:"
    kubectl get vm $VM_NAME -n $NAMESPACE -o jsonpath='{.status.printableStatus}' 2>/dev/null && echo ""
    echo ""
    echo "Ready 条件:"
    kubectl get vm $VM_NAME -n $NAMESPACE -o jsonpath='{.status.conditions[?(@.type=="Ready")]}' 2>/dev/null && echo ""
    echo ""
else
    echo "警告: VM '$VM_NAME' 不存在"
fi

echo ""
echo "=========================================="
echo "2. 虚拟机实例 (VMI) 状态"
echo "=========================================="
if kubectl get vmi $VM_NAME -n $NAMESPACE &> /dev/null; then
    echo "VMI 存在"
    echo ""
    echo "Phase 状态:"
    kubectl get vmi $VM_NAME -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null && echo ""
    echo ""
    echo "节点信息:"
    kubectl get vmi $VM_NAME -n $NAMESPACE -o jsonpath='{.status.nodeName}' 2>/dev/null && echo ""
    echo ""
    echo "IP 地址:"
    kubectl get vmi $VM_NAME -n $NAMESPACE -o jsonpath='{.status.interfaces[*].ipAddress}' 2>/dev/null && echo ""
    echo ""
    echo "Conditions (详细状态):"
    kubectl get vmi $VM_NAME -n $NAMESPACE -o jsonpath='{range .status.conditions[*]}{.type}: {.status} - {.reason} - {.message}{"\n"}{end}' 2>/dev/null
else
    echo "VMI 不存在（可能尚未创建或已删除）"
fi

echo ""
echo "=========================================="
echo "3. VMI 事件（最近 20 条）"
echo "=========================================="
EVENTS=$(kubectl get events -n $NAMESPACE \
    --field-selector involvedObject.name=$VM_NAME,involvedObject.kind=VirtualMachineInstance \
    --sort-by='.lastTimestamp' \
    --no-headers 2>/dev/null | tail -20)

if [ -z "$EVENTS" ]; then
    echo "未找到相关事件"
else
    echo "$EVENTS" | while IFS= read -r line; do
        if [ ! -z "$line" ]; then
            echo "$line"
        fi
    done
fi

echo ""
echo "=========================================="
echo "4. virt-launcher Pod 状态"
echo "=========================================="
PODS=$(kubectl get pods -n $NAMESPACE -l kubevirt.io/domain=$VM_NAME --no-headers 2>/dev/null)
if [ -z "$PODS" ]; then
    echo "未找到 virt-launcher Pod"
    echo ""
    echo "所有相关 Pod:"
    kubectl get pods -n $NAMESPACE | grep $VM_NAME || echo "未找到相关 Pod"
else
    echo "$PODS"
    echo ""
    POD_NAME=$(echo "$PODS" | head -1 | awk '{print $1}')
    if [ ! -z "$POD_NAME" ]; then
        echo "Pod 详细信息 ($POD_NAME):"
        kubectl get pod $POD_NAME -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null && echo ""
        echo ""
        echo "Pod Conditions:"
        kubectl get pod $POD_NAME -n $NAMESPACE -o jsonpath='{range .status.conditions[*]}{.type}: {.status} - {.reason} - {.message}{"\n"}{end}' 2>/dev/null
        echo ""
        echo "Pod 事件:"
        kubectl get events -n $NAMESPACE --field-selector involvedObject.name=$POD_NAME --sort-by='.lastTimestamp' --no-headers 2>/dev/null | tail -10
    fi
fi

echo ""
echo "=========================================="
echo "5. 节点亲和性检查"
echo "=========================================="
echo "检查节点标签 network.harvesterhci.io/jiqun:"
NODES_WITH_LABEL=$(kubectl get nodes --show-labels --no-headers 2>/dev/null | grep "network.harvesterhci.io/jiqun=true")
if [ -z "$NODES_WITH_LABEL" ]; then
    echo "警告: 没有节点具有标签 'network.harvesterhci.io/jiqun=true'"
    echo "这可能是导致调度失败的原因！"
    echo ""
    echo "所有节点:"
    kubectl get nodes --show-labels --no-headers 2>/dev/null | awk '{print $1, $NF}'
else
    echo "找到符合条件的节点:"
    echo "$NODES_WITH_LABEL" | awk '{print $1}'
fi

echo ""
echo "=========================================="
echo "6. 节点资源检查"
echo "=========================================="
echo "检查节点可用资源（CPU/内存）:"
kubectl get nodes --no-headers 2>/dev/null | while read -r node rest; do
    echo ""
    echo "节点: $node"
    kubectl describe node $node 2>/dev/null | grep -A 5 "Allocated resources" || echo "  无法获取资源信息"
done

echo ""
echo "=========================================="
echo "7. PVC 状态检查"
echo "=========================================="
PVC_NAME="lxc-xinference-disk-2-pxnrw"
if kubectl get pvc $PVC_NAME -n $NAMESPACE &> /dev/null; then
    echo "PVC '$PVC_NAME' 存在"
    echo ""
    echo "PVC 状态:"
    kubectl get pvc $PVC_NAME -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null && echo ""
    echo ""
    echo "PVC 详细信息:"
    kubectl get pvc $PVC_NAME -n $NAMESPACE -o yaml 2>/dev/null | grep -A 10 "status:"
else
    echo "警告: PVC '$PVC_NAME' 不存在"
    echo ""
    echo "所有相关 PVC:"
    kubectl get pvc -n $NAMESPACE | grep $VM_NAME || echo "未找到相关 PVC"
fi

echo ""
echo "=========================================="
echo "8. Multus 网络检查"
echo "=========================================="
echo "检查 Multus 网络配置 'default/test':"
if kubectl get network-attachment-definition test -n default &> /dev/null; then
    echo "Multus 网络 'default/test' 存在"
    kubectl get network-attachment-definition test -n default -o yaml 2>/dev/null | grep -A 5 "spec:"
else
    echo "警告: Multus 网络 'default/test' 不存在"
fi

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "建议检查项:"
echo "1. 如果 VMI 不存在，检查 Pod 事件和调度失败原因"
echo "2. 如果节点亲和性不满足，给节点添加标签或修改 VM 配置"
echo "3. 如果资源不足，释放资源或添加节点"
echo "4. 如果 PVC 未绑定，检查存储配置"
echo ""
