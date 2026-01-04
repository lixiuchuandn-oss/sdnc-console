import React from 'react';
import { Descriptions, Tag } from 'antd';

type Props = {
  vm: any;
};

const CsmVmOverviewSection: React.FC<Props> = ({ vm }) => {
  if (!vm) return null;

  const statusMap: any = { 0: '已关闭', 1: '正常', 2: '启动失败', 3: '启动中', 4: '部署中' };
  const colorMap: any = { 0: 'default', 1: 'green', 2: 'red', 3: 'blue', 4: 'processing' };
  
  const status = typeof vm.status === 'number' ? vm.status : vm.status;
  const statusText = statusMap[status] || status || '-';
  const statusColor = colorMap[status] || 'default';

  return (
    <Descriptions bordered column={2} size="small">
      <Descriptions.Item label="实例名称">{vm.vm_name || vm.name || '-'}</Descriptions.Item>
      <Descriptions.Item label="实例ID">{vm.vm_id || vm.id || '-'}</Descriptions.Item>
      <Descriptions.Item label="状态">
        <Tag color={statusColor}>{statusText}</Tag>
      </Descriptions.Item>
      <Descriptions.Item label="管理IP">{vm.manage_ip || '-'}</Descriptions.Item>
      <Descriptions.Item label="CPU">{vm.cpu ? `${vm.cpu} 核` : '-'}</Descriptions.Item>
      <Descriptions.Item label="内存">{vm.memory ? `${vm.memory} GB` : '-'}</Descriptions.Item>
      <Descriptions.Item label="类型">{vm.vm_type || '-'}</Descriptions.Item>
      <Descriptions.Item label="版本">{vm.vm_version || '-'}</Descriptions.Item>
      <Descriptions.Item label="模板名称">{vm.template_name || '-'}</Descriptions.Item>
      <Descriptions.Item label="宿主机ID">{vm.host_id || '-'}</Descriptions.Item>
      <Descriptions.Item label="Instance ID">{vm.instance_id || '-'}</Descriptions.Item>
      <Descriptions.Item label="厂商">{vm.vm_vendor || '-'}</Descriptions.Item>
      <Descriptions.Item label="镜像ID">{vm.image_id || '-'}</Descriptions.Item>
      <Descriptions.Item label="模板ID">{vm.template_id || '-'}</Descriptions.Item>
      <Descriptions.Item label="创建时间">{vm.createdAt || vm.createTime || '-'}</Descriptions.Item>
      <Descriptions.Item label="描述" span={2}>{vm.description || '-'}</Descriptions.Item>
    </Descriptions>
  );
};

export default CsmVmOverviewSection;
