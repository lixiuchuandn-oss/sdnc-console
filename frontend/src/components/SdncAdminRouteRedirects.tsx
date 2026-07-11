import React from 'react';
import { Navigate, Route } from 'react-router-dom';
import { isSdncProduct } from '../constants/productFlavor';

/**
 * SDNC 独立产品：屏蔽已裁剪平台的路由直达，重定向到 IBR 首页。
 * 须在 <Routes> 内以函数调用展开（`{sdncAdminRouteRedirectElements()}`），
 * 不可作为自定义组件子节点（RR v6 只接受 Route / Fragment）。
 */
export function sdncAdminRouteRedirectElements(): React.ReactNode {
  if (!isSdncProduct()) return null;
  return (
    <>
      <Route path="welcome" element={<Navigate to="/admin/interconnect/vr" replace />} />
      <Route path="dashboard" element={<Navigate to="/admin/interconnect/vr" replace />} />
      <Route path="clouds/*" element={<Navigate to="/admin/interconnect/vr" replace />} />
      <Route path="tenants/*" element={<Navigate to="/admin/interconnect/vr" replace />} />
      <Route path="sec-mgr-plane/*" element={<Navigate to="/admin/interconnect/vr" replace />} />
      <Route path="security/traffic/*" element={<Navigate to="/admin/interconnect/vr" replace />} />
    </>
  );
}
