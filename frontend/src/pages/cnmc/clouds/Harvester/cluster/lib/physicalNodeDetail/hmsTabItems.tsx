import React from 'react';
import { Descriptions, Empty, Flex, Table, Typography } from 'antd';
import type { TabsProps } from 'antd';
import {
  DESCR_COL1,
  DRAWER_TABLE_PROPS,
  HMS_DISK_COLS,
  HMS_LLDP_TABLE_COLUMNS,
  HMS_MEM_COLS,
  HMS_SYNC_HINT,
  HmsHwMissingPanel,
  PanelWide,
  displayCell,
  hmsCpuInfoLabelZh,
  hmsSystemInfoLabelZh,
  tableScrollXWhenHasData,
} from '../physicalNodeDetailDrawerLib';
import type { PhysicalNodeDetailDerived } from './tabModel';
import type { PhysicalNodeDetailTabContext } from './types';

export function buildHmsPhysicalNodeTabItems(
  ctx: PhysicalNodeDetailTabContext,
  derived: PhysicalNodeDetailDerived,
): NonNullable<TabsProps['items']> {
  const { hardware, nics, nicColumns } = ctx;
  const { diskList, memListSorted, swList, lldpTableRows, systemObj, cpuObj } = derived;
  const hw = hardware;

  return [
    {
      key: 'hms-board',
      label: 'HMS 主板',
      children: (
        <PanelWide>
          {!hw ? (
            <HmsHwMissingPanel />
          ) : systemObj ? (
            <Descriptions className="hms-hw-same-row-height" {...DESCR_COL1}>
              {Object.entries(systemObj).map(([k, v]) => (
                <Descriptions.Item key={k} label={hmsSystemInfoLabelZh(k)}>
                  {displayCell(v)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 system" />
          )}
        </PanelWide>
      ),
    },
    {
      key: 'hms-cpu',
      label: 'HMS 处理器',
      children: (
        <PanelWide>
          {!hw ? (
            <HmsHwMissingPanel />
          ) : cpuObj && Object.keys(cpuObj).length > 0 ? (
            <Descriptions className="hms-hw-same-row-height" {...DESCR_COL1}>
              {Object.entries(cpuObj).map(([k, v]) => (
                <Descriptions.Item key={k} label={hmsCpuInfoLabelZh(k)}>
                  {displayCell(v)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 cpu" />
          )}
        </PanelWide>
      ),
    },
    {
      key: 'hms-memory',
      label: 'HMS 内存',
      children: (
        <PanelWide>
          {!hw ? (
            <HmsHwMissingPanel />
          ) : memListSorted.length ? (
            <Table
              {...DRAWER_TABLE_PROPS}
              scroll={tableScrollXWhenHasData(memListSorted.length)}
              rowKey={(r, i) => `${String((r as { Locator?: string })?.Locator ?? '')}-${i ?? 0}`}
              columns={HMS_MEM_COLS}
              dataSource={memListSorted}
              pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 memory" />
          )}
        </PanelWide>
      ),
    },
    {
      key: 'hms-disk',
      label: 'HMS 存储',
      children: (
        <PanelWide>
          {!hw ? (
            <HmsHwMissingPanel />
          ) : diskList.length ? (
            <Table
              {...DRAWER_TABLE_PROPS}
              scroll={tableScrollXWhenHasData(diskList.length)}
              rowKey={(r, i) =>
                `${(r as { name?: string; type?: string })?.name || ''}-${(r as { type?: string })?.type || ''}-${i ?? 0}`
              }
              columns={HMS_DISK_COLS}
              dataSource={diskList}
              pagination={{ pageSize: 12, showTotal: (t) => `共 ${t} 条` }}
              expandable={{
                expandedRowRender: (r) => {
                  const children = (r as { children?: unknown[] }).children;
                  return Array.isArray(children) && children.length ? (
                    <Table
                      {...DRAWER_TABLE_PROPS}
                      scroll={tableScrollXWhenHasData(children.length)}
                      rowKey={(c, j) => `${(c as { name?: string })?.name}-${j ?? 0}`}
                      columns={HMS_DISK_COLS}
                      dataSource={children}
                      pagination={false}
                    />
                  ) : (
                    <Typography.Text type="secondary">无子项（children）</Typography.Text>
                  );
                },
                rowExpandable: (r) => {
                  const children = (r as { children?: unknown[] }).children;
                  return Array.isArray(children) && children.length > 0;
                },
              }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 disk" />
          )}
        </PanelWide>
      ),
    },
    {
      key: 'hms-nics',
      label: 'HMS 网卡',
      children: (
        <PanelWide>
          {nics.length ? (
            <Table
              {...DRAWER_TABLE_PROPS}
              scroll={tableScrollXWhenHasData(nics.length)}
              rowKey={(r) => `${r?.device || ''}-${r?.mac || ''}-${r?.master || ''}`}
              columns={nicColumns}
              dataSource={nics}
              pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 nics 数据">
              <Flex vertical align="center" gap="small">
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, textAlign: 'center' }}>
                  {HMS_SYNC_HINT}
                </Typography.Paragraph>
              </Flex>
            </Empty>
          )}
        </PanelWide>
      ),
    },
    {
      key: 'hms-lldp',
      label: 'HMS LLDP',
      children: (
        <PanelWide>
          {!hw ? (
            <HmsHwMissingPanel />
          ) : swList.length ? (
            <Table
              {...DRAWER_TABLE_PROPS}
              scroll={tableScrollXWhenHasData(lldpTableRows.length)}
              rowKey="key"
              columns={HMS_LLDP_TABLE_COLUMNS}
              dataSource={lldpTableRows}
              pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 条` }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 switch（LLDP）" />
          )}
        </PanelWide>
      ),
    },
  ];
}
