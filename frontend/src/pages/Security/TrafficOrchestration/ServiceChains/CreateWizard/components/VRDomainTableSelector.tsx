import React, { useState, useMemo } from 'react';
import { Input, Table, Tag, Button } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

const VRDomainTableSelector = ({ value, onChange, dataSource, showActions, onAddAsset, tableProps, hideHeader, searchKeyword, existingCidrs, csmAssets }: any) => {
  const [keyword, setKeyword] = useState('');
  const effectiveKeyword = (typeof searchKeyword === 'string') ? searchKeyword : keyword;

  const filteredData = useMemo(() => {
    if (!effectiveKeyword) return dataSource;
    const lower = effectiveKeyword.toLowerCase();
    return (dataSource || []).filter((item: any) => 
      (item.name && item.name.toLowerCase().includes(lower)) ||
      (item.subType && item.subType.toLowerCase().includes(lower)) ||
      (item.provider && item.provider.toLowerCase().includes(lower)) ||
      (item.region && item.region.toLowerCase().includes(lower)) ||
      (item.cidr && item.cidr.toLowerCase().includes(lower)) ||
      (item.vrName && item.vrName.toLowerCase().includes(lower))
    );
  }, [dataSource, effectiveKeyword]);

  const selectedKeys: React.Key[] = useMemo(() => {
    if (Array.isArray(value)) return value as React.Key[];
    if (typeof value === 'string') {
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }, [value]);

  const existingSet = useMemo(() => {
    const arr = Array.isArray(existingCidrs) ? existingCidrs : [];
    return new Set(arr.map(s => String(s || '').trim()));
  }, [existingCidrs]);

  const cidrToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    if (Array.isArray(csmAssets)) {
      csmAssets.forEach((a: any) => {
        const val = String(a?.value || '').trim();
        const id = a?.network_id || a?.id || a?.uuid;
        if (val && id) map.set(val, id);
      });
    }
    return map;
  }, [csmAssets]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {hideHeader ? null : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            placeholder="搜索名称、CIDR、VR或云厂商..."
            allowClear
            onChange={e => setKeyword(e.target.value)}
            style={{ width: 320 }}
          />
          <div style={{ color: '#999', fontSize: 12 }}>
            共 {dataSource?.length || 0} 项，已选 {selectedKeys.length} 项
          </div>
        </div>
      )}
      <Table
        bordered
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys: selectedKeys,
          onChange: (keys) => {
            const next = Array.isArray(keys) ? keys : [keys];
            onChange?.(next);
          },
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
          { 
            title: '资产ID (network_id)', 
            key: 'assetId', 
            width: 180,
            render: (_: any, r: any) => {
                const cidr = String(r.cidr || '').trim();
                const id = cidrToIdMap.get(cidr);
                return id ? <span style={{ fontSize: 12 }}>{id}</span> : '-';
            }
          },
          { title: '绑定 VR', dataIndex: 'vrName', width: 120, render: (t: any) => t ? <Tag color="blue">{t}</Tag> : '-' },
          ...(showActions ? [{
            title: '操作',
            key: 'actions',
            width: 160,
            render: (_: any, record: any) => {
              const cidrStr = String(record?.cidr || '').trim();
              const exists = cidrStr && existingSet.has(cidrStr);
              return (
                <>
                  {exists ? <Tag color="green" style={{ marginRight: 8 }}>已添加</Tag> : null}
                  <Button size="small" type="link" onClick={() => onAddAsset?.(record)}>添加到资产</Button>
                </>
              );
            }
          }] : [])
        ]}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 8, size: 'small', showSizeChanger: true, ...(tableProps?.pagination || {}) }}
        scroll={tableProps?.scroll}
        style={{ ...(tableProps?.style || {}) }}
        {...tableProps}
      />
    </div>
  );
};

export default VRDomainTableSelector;
