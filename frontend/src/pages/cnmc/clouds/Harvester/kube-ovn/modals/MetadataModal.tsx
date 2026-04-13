import React from 'react';
import { Modal, Input } from 'antd';

const MetadataModal: React.FC<{ visible: boolean; record: any; onClose: () => void }> = ({ visible, record, onClose }) => {
  return (
    <Modal
      title="元数据查看"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
    >
      <Input.TextArea
        readOnly
        autoSize={{ minRows: 10, maxRows: 20 }}
        value={record ? JSON.stringify(record, null, 2) : ''}
        style={{ fontFamily: 'monospace', backgroundColor: '#f5f5f5' }}
      />
    </Modal>
  );
};

export default MetadataModal;
