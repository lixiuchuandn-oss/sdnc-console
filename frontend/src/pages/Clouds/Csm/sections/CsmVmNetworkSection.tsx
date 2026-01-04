import React from 'react';
import { Table } from 'antd';
import { ApiOutlined } from '@ant-design/icons';

type Props = {
  vm: any;
};

const CsmVmNetworkSection: React.FC<Props> = ({ vm }) => {
  const list = Array.isArray(vm?.interfaceList) ? vm.interfaceList : [];

  const columns = [
    { title: '网卡名称', dataIndex: 'networkCardName', key: 'name' },
    { title: 'IP地址', dataIndex: 'networkIp', key: 'ip' },
    { title: '网络类型', dataIndex: 'networkType', key: 'type' },
    { title: '配置模式', dataIndex: 'configIpMode', key: 'mode', render: (t: any) => {
      const map: any = { 'static': '静态', 'dhcp': 'DHCP', 'out_dhcp': '外部DHCP' };
      return map[t] || t;
    }},
    { title: '透传类型', dataIndex: 'passType', key: 'pass', render: (t: any) => (t === 2 ? '透传' : '普通') },
    { title: '网络ID', dataIndex: 'networkId', key: 'netId' },
  ];

  return (
    <Table
      size="small"
      bordered={false}
      rowKey={(r: any) => r.networkId || r.networkCardName}
      columns={columns}
      dataSource={list}
      pagination={false}
    />
  );
};

(CsmVmNetworkSection as any).tabMeta = {
  key: 'network',
  title: '网络接口',
  icon: <ApiOutlined />,
  countOf: (props: any) => {
    return Array.isArray(props?.vm?.interfaceList) ? props.vm.interfaceList.length : 0;
  }
};

export default CsmVmNetworkSection;
