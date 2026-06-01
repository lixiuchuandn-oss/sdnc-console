import React from 'react';

type WriteGuardProps = {
  canWrite: boolean;
  children: React.ReactNode;
  /** 无写权限时的占位，默认不渲染 */
  fallback?: React.ReactNode;
};

/** 有 write 权限时才渲染子节点（用于新增/编辑/删除按钮） */
const WriteGuard: React.FC<WriteGuardProps> = ({ canWrite, children, fallback = null }) => {
  if (!canWrite) return <>{fallback}</>;
  return <>{children}</>;
};

export default WriteGuard;
