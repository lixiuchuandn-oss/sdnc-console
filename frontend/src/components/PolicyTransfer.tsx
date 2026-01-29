import React, { useMemo } from 'react';
import { Empty, Button, List, Checkbox, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { TransferItem } from 'antd/es/transfer';

interface Props {
  dataSource: TransferItem[]; // The filtered list for the left side
  selectedDataSource: TransferItem[]; // The full list of selected items for the right side (to avoid missing items when filtered out)
  targetKeys: string[];
  onChange: (targetKeys: string[]) => void;
  titles?: [string, string];
  style?: React.CSSProperties;
}

const PolicyTransfer: React.FC<Props> = (props) => {
  const { dataSource, selectedDataSource, targetKeys, onChange, titles, style } = props;

  const handleToggle = (key: string, checked: boolean) => {
    const nextKeys = checked 
      ? [...targetKeys, key]
      : targetKeys.filter(k => k !== key);
    onChange(nextKeys);
  };

  const handleRemove = (key: string) => {
    const nextKeys = targetKeys.filter(k => k !== key);
    onChange(nextKeys);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Add all visible keys that are not yet selected
      const visibleKeys = dataSource.map(d => d.key as string);
      const toAdd = visibleKeys.filter(k => !targetKeys.includes(k));
      onChange([...targetKeys, ...toAdd]);
    } else {
      // Unselect all visible keys
      const visibleKeys = new Set(dataSource.map(d => d.key as string));
      const nextKeys = targetKeys.filter(k => !visibleKeys.has(k));
      onChange(nextKeys);
    }
  };

  const allVisibleSelected = dataSource.length > 0 && dataSource.every(d => targetKeys.includes(d.key as string));
  const indeterminate = dataSource.some(d => targetKeys.includes(d.key as string)) && !allVisibleSelected;

  return (
    <div style={{ display: 'flex', border: '1px solid #d9d9d9', borderRadius: 8, height: '100%', ...style }}>
      {/* Left Panel: Filtered Policy List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #f0f0f0', overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Checkbox 
            checked={allVisibleSelected} 
            indeterminate={indeterminate} 
            onChange={e => handleSelectAll(e.target.checked)} 
            disabled={dataSource.length === 0}
          />
          <span>{titles?.[0] || '可选策略'}</span>
          <span style={{ color: '#999', fontSize: 12, marginLeft: 'auto' }}>{dataSource.length} 项</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
          {dataSource.length === 0 ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%', padding: 20 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配策略" />
            </div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {dataSource.map(item => {
                const checked = targetKeys.includes(item.key as string);
                return (
                  <div 
                    key={item.key}
                    onClick={() => handleToggle(item.key as string, !checked)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'flex-start',
                      padding: '8px 12px', 
                      cursor: 'pointer',
                      background: checked ? '#e6f7ff' : 'transparent',
                      transition: 'background 0.3s'
                    }}
                  >
                    <Checkbox checked={checked} style={{ marginTop: 4, marginRight: 8 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{item.title}</div>
                      {item.description && <div style={{ fontSize: 12, color: '#888' }}>{item.description}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Selected List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>{titles?.[1] || '已分配'}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{selectedDataSource.length} 项</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
          {selectedDataSource.length === 0 ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%', color:'#ccc' }}>
              暂无已选项目
            </div>
          ) : (
            <List
              dataSource={selectedDataSource}
              renderItem={(item) => (
                <List.Item
                  actions={[<Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleRemove(item.key as string)} />]}
                  style={{ padding: '8px 12px' }}
                >
                  <List.Item.Meta
                    title={<span style={{ fontWeight: 500 }}>{item.title}</span>}
                    description={<span style={{ fontSize: 12 }}>{item.description}</span>}
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PolicyTransfer;
