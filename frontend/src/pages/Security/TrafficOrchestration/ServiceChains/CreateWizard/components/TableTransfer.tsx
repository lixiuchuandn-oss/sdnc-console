import React from 'react';
import { Transfer, Table } from 'antd';
import type { TransferProps } from 'antd/es/transfer';
import type { ColumnsType, TableProps } from 'antd/es/table';
import type { CustomTransferItem } from '../constants';

interface TableTransferProps extends TransferProps<CustomTransferItem> {
  dataSource: CustomTransferItem[];
  leftColumns: ColumnsType<CustomTransferItem>;
  rightColumns: ColumnsType<CustomTransferItem>;
}

const TableTransfer = ({ leftColumns, rightColumns, ...restProps }: TableTransferProps) => (
  <Transfer {...restProps}>
    {({
      direction,
      filteredItems,
      onItemSelectAll,
      onItemSelect,
      selectedKeys: listSelectedKeys,
      disabled: listDisabled,
    }) => {
      const columns = direction === 'left' ? leftColumns : rightColumns;

      const rowSelection: TableProps<CustomTransferItem>['rowSelection'] = {
        getCheckboxProps: (item) => ({ disabled: listDisabled || item.disabled }),
        onSelectAll(selected, selectedRows) {
          const treeSelectedKeys = selectedRows
            .filter((item) => !item.disabled)
            .map(({ key }) => key);
          const diffKeys = selected
            ? treeSelectedKeys.filter((key) => !listSelectedKeys.includes(key as string))
            : listSelectedKeys.filter((key) => treeSelectedKeys.includes(key as string));
          onItemSelectAll(diffKeys as string[], selected);
        },
        onSelect({ key }, selected) {
          if (key !== undefined) {
            onItemSelect(key as string, selected);
          }
        },
        selectedRowKeys: listSelectedKeys,
      };

      return (
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={filteredItems}
          size="small"
          pagination={false}
          scroll={{ y: 305 }}
          style={{ pointerEvents: listDisabled ? 'none' : undefined }}
          onRow={({ key, disabled: itemDisabled }) => ({
            onClick: () => {
              if (listDisabled || itemDisabled) return;
              onItemSelect(key as string, !listSelectedKeys.includes(key as string));
            },
          })}
        />
      );
    }}
  </Transfer>
);

export default TableTransfer;
