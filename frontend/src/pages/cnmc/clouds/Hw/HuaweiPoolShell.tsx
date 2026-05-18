/**
 * CNMC：`admin/clouds/vendor/huawei/:id` 挂载入口（与 CloudmapPoolShell 同构）。
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import CloudDetailHw from './CloudDetailHw';

const HuaweiPoolShell: React.FC = () => {
  const { id } = useParams();
  if (!id) return null;
  return <CloudDetailHw cloudId={id} key={id} />;
};

export default HuaweiPoolShell;
