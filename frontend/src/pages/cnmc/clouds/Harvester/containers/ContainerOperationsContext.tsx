/**
 * 容器服务（Harvester K8s）写操作门控：由资源池详情 / 租户控制台包裹 Provider，
 * 各 Section 通过 hook 统一隐藏创建、删除、扩缩容、终端等写能力。
 */
import React, { createContext, useContext, useMemo } from 'react';

type ContainerOperationsCtx = {
  /** true 表示仅允许查看类操作（日志/详情/YAML 等仍可用） */
  operationsReadOnly: boolean;
};

const defaultValue: ContainerOperationsCtx = { operationsReadOnly: false };

export const ContainerOperationsContext = createContext<ContainerOperationsCtx>(defaultValue);

export function useContainerOperationsReadOnly(): boolean {
  return useContext(ContainerOperationsContext).operationsReadOnly;
}

export function ContainerOperationsGate({
  operationsReadOnly,
  children,
}: {
  operationsReadOnly: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const value = useMemo(() => ({ operationsReadOnly }), [operationsReadOnly]);
  return (
    <ContainerOperationsContext.Provider value={value}>{children}</ContainerOperationsContext.Provider>
  );
}
