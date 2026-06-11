import React, { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

function stopTreePointer(e: React.SyntheticEvent) {
  e.stopPropagation();
}

/** 树内联添加子组织：名称用本地 state，避免父级 treeData 随输入重建导致中文 IME 失效 */
export function InlineOrgAddChildRow({
  onSave,
  onCancel,
}: {
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');

  return (
    <div style={rowStyle} onClick={stopTreePointer} onMouseDown={stopTreePointer}>
      <Input
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="请输入组织名称"
        style={{ width: 200 }}
      />
      <Button
        type="link"
        size="small"
        icon={<CheckOutlined />}
        disabled={!name.trim()}
        onClick={(e) => {
          stopTreePointer(e);
          onSave(name.trim());
        }}
      >
        保存
      </Button>
      <Button
        type="link"
        size="small"
        icon={<CloseOutlined />}
        onClick={(e) => {
          stopTreePointer(e);
          onCancel();
        }}
      >
        取消
      </Button>
    </div>
  );
}

/** 树内联重命名：名称用本地 state，避免中文 IME 被树节点重建打断 */
export function InlineOrgRenameRow({
  initialName,
  onSave,
  onCancel,
}: {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <div style={rowStyle} onClick={stopTreePointer} onMouseDown={stopTreePointer}>
      <Input
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: 180 }}
      />
      <Button
        type="link"
        size="small"
        icon={<CheckOutlined />}
        disabled={!name.trim()}
        onClick={(e) => {
          stopTreePointer(e);
          onSave(name.trim());
        }}
      >
        保存
      </Button>
      <Button
        type="link"
        size="small"
        icon={<CloseOutlined />}
        onClick={(e) => {
          stopTreePointer(e);
          onCancel();
        }}
      >
        取消
      </Button>
    </div>
  );
}
