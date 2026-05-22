/**
 * CNMC：`admin/clouds/vendor/aliyun/:id` 挂载入口（与 CloudmapPoolShell 同构）。
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import CloudDetailAliyun from './CloudDetailAliyun';

const AliyunPoolShell: React.FC = () => {
  const { id } = useParams();
  if (!id) return null;
  return <CloudDetailAliyun cloudId={id} key={id} />;
};

export default AliyunPoolShell;
