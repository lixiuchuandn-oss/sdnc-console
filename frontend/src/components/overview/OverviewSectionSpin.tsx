import React from 'react';
import { Spin } from 'antd';

type Props = {
  loading?: boolean;
  children: React.ReactNode;
};

/** 概览区统一加载态：整块 Spin，首屏与手动刷新一致 */
const OverviewSectionSpin: React.FC<Props> = ({ loading, children }) => (
  <Spin spinning={!!loading}>
    <div style={{ minHeight: loading ? 120 : undefined }}>{children}</div>
  </Spin>
);

export default OverviewSectionSpin;
