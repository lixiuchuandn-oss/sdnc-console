import React from 'react';
import { Descriptions, Flex, Space, Tag, Typography } from 'antd';
import type { TabsProps } from 'antd';
import {
  formatBytesToGiB,
  formatCpuToCoresText,
} from '../physicalNodeDetailFormatters';
import { DESCR_COL1, Panel, displayCell } from '../physicalNodeDetailDrawerLib';
import type { PhysicalNodeDetailDerived } from './tabModel';
import type { PhysicalNodeDetailTabContext } from './types';

export function buildHarvesterPhysicalNodeTabItems(
  ctx: PhysicalNodeDetailTabContext,
  derived: PhysicalNodeDetailDerived,
): NonNullable<TabsProps['items']> {
  const {
    record,
    titleName,
    ready,
    nodeRoles,
    internalIP,
    harvesterVersion,
    annotations,
    ntp,
    podRequests,
    podLimits,
    physicalIfaces,
    ifaceStatusMap,
  } = ctx;

  const {
    status,
    capCpu,
    capMem,
    allocCpu,
    allocMem,
    cpuUsageDisplay,
    memUsageDisplay,
    cpuUsageTextType,
    memUsageTextType,
    systemInfo,
  } = derived;

  return [
    {
      key: 'harv-node',
      label: '物理节点',
      children: (
        <Panel>
          <Descriptions {...DESCR_COL1}>
            <Descriptions.Item label="名称">{titleName}</Descriptions.Item>
            <Descriptions.Item label="就绪">{ready ? 'Ready' : 'NotReady'}</Descriptions.Item>
            <Descriptions.Item label="角色">
              {nodeRoles.length ? (
                <Space wrap size={[4, 4]}>
                  {nodeRoles.map((role) => (
                    <Tag key={role}>{role}</Tag>
                  ))}
                </Space>
              ) : null}
            </Descriptions.Item>
            {systemInfo?.['Product Name'] ? (
              <Descriptions.Item label="机型（HMS SMBIOS）">
                {[String(systemInfo?.Manufacturer || '').trim(), String(systemInfo?.['Product Name'] || '').trim()]
                  .filter(Boolean)
                  .join(' ')}
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label="CPU 使用（实时）">
              <Typography.Text type={cpuUsageTextType}>{cpuUsageDisplay}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="内存使用（实时）">
              <Typography.Text type={memUsageTextType}>{memUsageDisplay}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="内网 IP">
              {internalIP ? (
                <Typography.Text copyable={{ text: String(internalIP) }} code>
                  {internalIP}
                </Typography.Text>
              ) : null}
            </Descriptions.Item>
            <Descriptions.Item label="容量 CPU">{displayCell(capCpu)}</Descriptions.Item>
            <Descriptions.Item label="可分配 CPU">{displayCell(allocCpu)}</Descriptions.Item>
            <Descriptions.Item label="容量内存">{displayCell(capMem)}</Descriptions.Item>
            <Descriptions.Item label="可分配内存">{displayCell(allocMem)}</Descriptions.Item>
            <Descriptions.Item label="物理口（LinkMonitor）">
              {physicalIfaces.length ? (
                <Flex vertical gap={4}>
                  {physicalIfaces.map((name) => {
                    const st = ifaceStatusMap[name];
                    return (
                      <Space key={name} size="small" align="center">
                        <Typography.Text code>{name}</Typography.Text>
                        {st ? <Tag>{st}</Tag> : null}
                      </Space>
                    );
                  })}
                </Flex>
              ) : (
                <Typography.Text type="secondary">未从 LinkMonitor 解析到 device 口</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="版本">
              {displayCell(record?.kubeletVersion || status?.nodeInfo?.kubeletVersion || record?.version)}
            </Descriptions.Item>
            <Descriptions.Item label="架构">
              {displayCell(record?.architecture || status?.nodeInfo?.architecture)}
            </Descriptions.Item>
            <Descriptions.Item label="系统镜像">
              {displayCell(record?.osImage || status?.nodeInfo?.osImage)}
            </Descriptions.Item>
            <Descriptions.Item label="内核">
              {displayCell(record?.kernelVersion || status?.nodeInfo?.kernelVersion)}
            </Descriptions.Item>
            <Descriptions.Item label="容器运行时">
              {displayCell(record?.containerRuntimeVersion || status?.nodeInfo?.containerRuntimeVersion)}
            </Descriptions.Item>
          </Descriptions>
        </Panel>
      ),
    },
    {
      key: 'harv-annotations',
      label: '注解与网络',
      children: (
        <Panel>
          <Descriptions {...DESCR_COL1}>
            <Descriptions.Item label="集群版本展示">{displayCell(harvesterVersion)}</Descriptions.Item>
            <Descriptions.Item label="NTP 同步">{displayCell(ntp?.ntpSyncStatus)}</Descriptions.Item>
            <Descriptions.Item label="NTP 服务器">
              <Typography.Text style={{ wordBreak: 'break-all' }}>{displayCell(ntp?.currentNtpServers)}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="OVN 节点 IP">
              {displayCell(annotations?.['ovn.kubernetes.io/ip_address'])}
            </Descriptions.Item>
            <Descriptions.Item label="OVN 节点 MAC">
              {displayCell(annotations?.['ovn.kubernetes.io/mac_address'])}
            </Descriptions.Item>
            <Descriptions.Item label="OVN CIDR">{displayCell(annotations?.['ovn.kubernetes.io/cidr'])}</Descriptions.Item>
            <Descriptions.Item label="OVN 网关">{displayCell(annotations?.['ovn.kubernetes.io/gateway'])}</Descriptions.Item>
            <Descriptions.Item label="Flannel 对外 IP">
              {displayCell(annotations?.['flannel.alpha.coreos.com/public-ip'])}
            </Descriptions.Item>
            <Descriptions.Item label="etcd 本地快照时间">
              {displayCell(annotations?.['etcd.rke2.cattle.io/local-snapshots-timestamp'])}
            </Descriptions.Item>
          </Descriptions>
        </Panel>
      ),
    },
    {
      key: 'harv-sched',
      label: '调度预留',
      children: (
        <Panel>
          <Descriptions {...DESCR_COL1}>
            <Descriptions.Item label="CPU 请求（Requests）">
              {podRequests?.cpu
                ? `${String(podRequests.cpu)}（约 ${formatCpuToCoresText(podRequests.cpu)}）`
                : null}
            </Descriptions.Item>
            <Descriptions.Item label="内存请求（Requests）">
              {podRequests?.memory
                ? `${String(podRequests.memory)}（约 ${formatBytesToGiB(podRequests.memory)}）`
                : null}
            </Descriptions.Item>
            <Descriptions.Item label="Pod 数请求">{displayCell(podRequests?.pods)}</Descriptions.Item>
            <Descriptions.Item label="临时存储请求">{displayCell(podRequests?.['ephemeral-storage'])}</Descriptions.Item>
            <Descriptions.Item label="CPU 上限（Limits）">
              {podLimits?.cpu ? `${String(podLimits.cpu)}（约 ${formatCpuToCoresText(podLimits.cpu)}）` : null}
            </Descriptions.Item>
            <Descriptions.Item label="内存上限（Limits）">
              {podLimits?.memory
                ? `${String(podLimits.memory)}（约 ${formatBytesToGiB(podLimits.memory)}）`
                : null}
            </Descriptions.Item>
          </Descriptions>
        </Panel>
      ),
    },
  ];
}
