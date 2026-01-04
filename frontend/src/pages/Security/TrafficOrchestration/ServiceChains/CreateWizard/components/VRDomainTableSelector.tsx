import React, { useState, useMemo } from 'react';
import { Input, Table, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

const VRDomainTableSelector = ({ value, onChange, dataSource }: any) => {
  const [keyword, setKeyword] = useState('');

  const filteredData = useMemo(() => {
    if (!keyword) return dataSource;
    const lower = keyword.toLowerCase();
    return (dataSource || []).filter((item: any) => 
      (item.name && item.name.toLowerCase().includes(lower)) ||
      (item.subType && item.subType.toLowerCase().includes(lower)) ||
      (item.provider && item.provider.toLowerCase().includes(lower)) ||
      (item.region && item.region.toLowerCase().includes(lower)) ||
      (item.cidr && item.cidr.toLowerCase().includes(lower)) ||
      (item.vrName && item.vrName.toLowerCase().includes(lower))
    );
  }, [dataSource, keyword]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          placeholder="搜索名称、CIDR、VR或云厂商..."
          allowClear
          onChange={e => setKeyword(e.target.value)}
          style={{ width: 320 }}
        />
        <div style={{ color: '#999', fontSize: 12 }}>
          共 {dataSource?.length || 0} 项，已选 {(value || []).length} 项
        </div>
      </div>
      <Table
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys: value || [],
          onChange: (keys) => onChange?.(keys),
          preserveSelectedRowKeys: true,
        }}
        dataSource={filteredData}
        columns={[
          { title: '名称', dataIndex: 'name', width: 120, ellipsis: true },
          { 
            title: '分类', 
            dataIndex: 'subType', 
            width: 140,
            render: (text: any) => text ? <Tag>{text}</Tag> : '-' 
          },
          { 
            title: '云厂商/地域', 
            key: 'cloud',
            width: 160,
            render: (_, r: any) => (r.provider || r.region) ? `${r.provider || '-'}/${r.region || '-'}` : '-' 
          },
          { title: 'IPv4 CIDR', dataIndex: 'cidr', width: 130, render: (t: any) => t ? <Tag>{t}</Tag> : '-' },
          { title: '绑定 VR', dataIndex: 'vrName', width: 120, render: (t: any) => t ? <Tag color="blue">{t}</Tag> : '-' },
        ]}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 5, size: 'small' }}
        scroll={{ y: 240 }}
        style={{ border: '1px solid #f0f0f0', borderRadius: 8 }}
      />
    </div>
  );
};

export default VRDomainTableSelector;
