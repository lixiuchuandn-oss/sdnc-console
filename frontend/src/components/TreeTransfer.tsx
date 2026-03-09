import React, { useMemo } from 'react';
import { Tree, Empty, Button, List, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { TransferItem } from 'antd/es/transfer';
import { PLATFORM_LABELS } from '../constants/navigation';
import { groupOf, featureLabelOf, platformOf } from '../constants/permissionCatalog';

interface Props {
  dataSource: TransferItem[];
  targetKeys: string[];
  onChange: (targetKeys: string[]) => void; // Simplified signature
  titles?: [string, string];
  style?: React.CSSProperties;
  listStyle?: React.CSSProperties;
  render?: (item: TransferItem) => any;
  groupMode?: 'permission' | 'flat';
}

// Helper to build tree data from flat list
const buildTreeData = (data: TransferItem[], mode: 'permission' | 'flat' = 'permission') => {
  if (mode === 'flat') {
    return data.map(item => ({
      key: String(item.key),
      title: item.title,
      isLeaf: true,
      description: item.description,
    }));
  }
  const platformMap = new Map<string, any>();
  
  data.forEach(item => {
    const key = item.key as string;
    const prefix = key.split(':')[0];
    const group = groupOf(prefix) || '其他';
    const feature = featureLabelOf(prefix);
    const platformCode = platformOf(prefix) || 'CNMC';
    const platformLabel = PLATFORM_LABELS[platformCode] || platformCode;
    
    let platformNode = platformMap.get(platformCode);
    if (!platformNode) {
      platformNode = { 
        key: `p:${platformCode}`, 
        title: platformLabel, 
        children: [], 
        selectable: false, 
        isLeaf: false 
      };
      platformMap.set(platformCode, platformNode);
    }

    let groupNode = platformNode.children.find((c: any) => c.title === group);
    if (!groupNode) {
      groupNode = { key: `g:${platformCode}:${group}`, title: group, children: [], selectable: false, isLeaf: false };
      platformNode.children.push(groupNode);
    }
    
    let featureNode = groupNode.children.find((c: any) => c.title === feature);
    if (!featureNode) {
      featureNode = { key: `f:${prefix}`, title: feature, children: [], selectable: false, isLeaf: false };
      groupNode.children.push(featureNode);
    }
    
    featureNode.children.push({
      key: key,
      title: item.title, // Action string
      isLeaf: true,
      description: item.description,
    });
  });

  return Array.from(platformMap.values());
};

const PermissionTreeTransfer: React.FC<Props> = (props) => {
  const { dataSource, targetKeys, onChange, titles, style, groupMode = 'permission' } = props;
  
  // Only rebuild tree when dataSource changes (ignore targetKeys changes)
  const treeData = useMemo(() => buildTreeData(dataSource, groupMode), [dataSource, groupMode]);

  // Map targetKeys to full item objects for the right list
  const selectedItems = useMemo(() => {
    return targetKeys.map(key => dataSource.find(d => d.key === key)).filter(Boolean) as TransferItem[];
  }, [targetKeys, dataSource]);

  const getLeafKeys = (node: any): string[] => {
    if (node.isLeaf) return [node.key];
    if (node.children) return node.children.flatMap(getLeafKeys);
    return [];
  };

  const handleTreeCheck = (checked: any, info: any) => {
    // Antd Tree onCheck returns { checked: [], halfChecked: [] } or just [] depending on checkStrictly
    // We used checkStrictly={false} so checked is array of keys
    
    // However, the Tree contains internal nodes (platforms, groups) which are not valid targetKeys
    // We must filter them out and only keep leaf keys (actual permissions)
    const allChecked = Array.isArray(checked) ? checked : checked.checked;
    
    // We can't easily distinguish leaf keys from internal keys just by looking at the key string
    // So we traverse the treeData or just filter by existence in dataSource
    const validKeys = new Set(dataSource.map(d => d.key));
    const newTargetKeys = allChecked.filter((k: string) => validKeys.has(k));
    
    onChange(newTargetKeys);
  };

  const handleRemove = (key: string) => {
    const newKeys = targetKeys.filter(k => k !== key);
    onChange(newKeys);
  };

  return (
    <div style={{ display: 'flex', border: '1px solid #d9d9d9', borderRadius: 8, height: '100%', ...style }}>
      {/* Left Panel: Tree Selector */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #f0f0f0', overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', fontWeight: 500 }}>
          {titles?.[0] || '可选权限'}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {treeData.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
          ) : (
            <Tree
              blockNode
              checkable
              checkStrictly={false}
              defaultExpandAll
              checkedKeys={targetKeys}
              treeData={treeData}
              onCheck={handleTreeCheck}
              titleRender={(node: any) => {
                  if (!node.isLeaf) return <span style={{ fontFamily: 'monospace' }}>{node.title}</span>;
                  return (
                  <div style={{ display:'flex', flexDirection:'column', lineHeight:'1.4', padding:'4px 0' }}>
                      <span style={{ fontFamily: 'monospace' }}>{node.title}</span>
                      <span style={{ fontSize: 12, color: '#888' }}>{node.description}</span>
                  </div>
                  );
              }}
            />
          )}
        </div>
      </div>

      {/* Right Panel: Selected List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>{titles?.[1] || '已分配'}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{selectedItems.length} 项</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
          {selectedItems.length === 0 ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%', color:'#ccc' }}>
              暂无已选项目
            </div>
          ) : (
            <List
              dataSource={selectedItems}
              renderItem={(item) => (
                <List.Item
                  actions={[<Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleRemove(item.key as string)} />]}
                  style={{ padding: '8px 12px' }}
                >
                  <List.Item.Meta
                    title={<span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{item.title}</span>}
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

export default PermissionTreeTransfer;
