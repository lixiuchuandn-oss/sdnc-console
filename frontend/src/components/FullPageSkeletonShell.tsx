/**
 * 整页数据区：骨架占位 + 隐藏挂载子树（便于在不可见时先发请求），适用于多阶段加载页面。
 * 与单纯包装 Skeleton 不同：统一「占位可见 / 内容 display:none」两段式交互。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Skeleton } from 'antd';

const DEFAULT_BLOCK_SKELETON = <Skeleton active paragraph={{ rows: 6 }} style={{ paddingTop: 8 }} />;

export type FullPageSkeletonShellProps = {
  /** true：展示骨架并隐藏子树（子树仍挂载） */
  showSkeleton: boolean;
  children?: React.ReactNode;
  /** 可选自定义骨架节点 */
  skeleton?: React.ReactNode;
};

export function FullPageSkeletonShell({ showSkeleton, children, skeleton }: FullPageSkeletonShellProps) {
  return (
    <>
      {showSkeleton ? (skeleton ?? DEFAULT_BLOCK_SKELETON) : null}
      <div style={{ display: showSkeleton ? 'none' : 'block' }}>{children}</div>
    </>
  );
}

/**
 * 与 FullPageSkeletonShell 配套：在依赖变化时清零 ready，数据就绪后调用 markReady。
 * @param resetDeps 任一变更为「新一轮加载」，例如 cloudId、外层探测 loading 标志
 */
export function useSkeletonShellReady(...resetDeps: unknown[]): {
  ready: boolean;
  markReady: () => void;
} {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    setReady(false);
  }, resetDeps);

  return { ready, markReady };
}
