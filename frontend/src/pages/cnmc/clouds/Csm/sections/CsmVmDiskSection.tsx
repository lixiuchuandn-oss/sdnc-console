import React from 'react';
import { Table } from 'antd';
import { HddOutlined } from '@ant-design/icons';

type Props = {
  vm: any;
};

const CsmVmDiskSection: React.FC<Props> = ({ vm }) => {
  const list = Array.isArray(vm?.dev_disk) ? vm.dev_disk : [];

  const columns = [
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: any) => (t === 'system' ? '系统盘' : (t === 'data' ? '数据盘' : t)) },
    { title: '容量 (GB)', dataIndex: 'size', key: 'size' },
  ];

  return (
    <Table
      size="small"
      bordered={false}
      rowKey={(_: any, idx?: number) => `${idx}`}
      columns={columns}
      dataSource={list}
      pagination={false}
    />
  );
};

(CsmVmDiskSection as any).tabMeta = {
  key: 'disks',
  title: '磁盘',
  icon: <HddOutlined />,
  countOf: (props: any) => {
    return Array.isArray(props?.vm?.dev_disk) ? props.vm.dev_disk.length : 0;
  }
};

export default CsmVmDiskSection;
