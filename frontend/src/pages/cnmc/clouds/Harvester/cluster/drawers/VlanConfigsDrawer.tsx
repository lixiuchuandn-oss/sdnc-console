/**
 * ClusterNetwork 聚合行下的 VlanConfig 列表展示（antd Drawer + Table）。
 */
import React, { useMemo } from 'react';

import { Drawer, Empty, Table } from 'antd';

import { buildVlanConfigsTableColumns, type VlanConfigRow } from '../lib/vlanConfigsTableColumns';

export type VlanConfigsDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** 通常为 `VlanConfig · {ClusterNetwork.metadata.name}` */
  title: string;
  /** 与列表行聚合的 vlanConfigs（可为空数组） */
  vlanConfigs?: readonly unknown[] | undefined;
};

const VlanConfigsDrawer: React.FC<VlanConfigsDrawerProps> = ({
  open,
  onClose,
  title,
  vlanConfigs,
}) => {
  const dataSource = (Array.isArray(vlanConfigs) ? vlanConfigs : []) as VlanConfigRow[];
  const columns = useMemo(() => buildVlanConfigsTableColumns(), []);

  return (
    <Drawer title={title} width={800} open={open} onClose={onClose} destroyOnHidden>
      {dataSource.length ? (
        <Table<VlanConfigRow>
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          rowKey={(r, i) =>
            String((r as { metadata?: { uid?: string; name?: string } }).metadata?.uid || '') ||
            String((r as { metadata?: { name?: string } }).metadata?.name || '') ||
            `vlan-${i}`
          }
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 VlanConfig 配置" />
      )}
    </Drawer>
  );
};

export default VlanConfigsDrawer;
