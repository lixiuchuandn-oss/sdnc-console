import React from 'react';
import { Modal, Table } from 'antd';

type Props = {
  open: boolean;
  target: any | null;
  subnets: any[];
  onClose: () => void;
};

const RouteTableSubnetsViewModal: React.FC<Props> = ({ open, target, subnets, onClose }) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="60vw"
      destroyOnHidden
      footer={null}
      centered
      title={`关联子网列表 · ${target?.name || target?.id || '-'}`}
    >
      <Table
        size="small"
        rowKey={(r: any) => r.id}
        columns={[
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: 'ID', dataIndex: 'id', key: 'id' },
          { title: 'CIDR', dataIndex: 'cidr', key: 'cidr' },
        ] as any}
        dataSource={(() => {
          const list: any[] = Array.isArray(target?.subnets) ? target!.subnets : [];
          const ids = list.map((x: any) => x?.id || x?.SubnetId).filter(Boolean);
          const out: any[] = [];
          const seen = new Set<string>();
          for (const id of ids) {
            const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(id || ''));
            const row = { id: id, name: sn?.name || '-', cidr: sn?.cidr || '-' };
            if (!seen.has(row.id)) { seen.add(row.id); out.push(row); }
          }
          return out;
        })()}
        pagination={false}
      />
    </Modal>
  );
};

export default RouteTableSubnetsViewModal;