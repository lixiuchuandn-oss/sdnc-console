import React from 'react';
import { Alert, Collapse, Descriptions, Flex, Tag, Typography } from 'antd';
import type { TabsProps } from 'antd';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import AswCliOutputCollapse from '../components/AswCliOutputCollapse';
import {
  aswCtlServiceHealthLabel,
  aswCtlServiceHealthTone,
  type KpiTone,
  type SwitchProbeDrawerModel,
} from './physicalSwitchProbeTabsLib';

export const SWITCH_PROBE_DESCR_COL1 = {
  bordered: true as const,
  size: 'small' as const,
  column: 1 as const,
  styles: { label: { width: 200 } },
};

function statusTag(state: string, tone: KpiTone): React.ReactNode {
  if (tone === 'err') return <Tag color="error">{state}</Tag>;
  if (tone === 'warn') return <Tag color="warning">{state}</Tag>;
  if (tone === 'ok') return <Tag color="success">{state}</Tag>;
  return <Tag>{state}</Tag>;
}

function serviceHealthTag(record: AswCtlSwitchProbeRecord): React.ReactNode {
  return statusTag(aswCtlServiceHealthLabel(record), aswCtlServiceHealthTone(record));
}

export function buildPhysicalSwitchProbeTabItems(model: SwitchProbeDrawerModel): TabsProps['items'] {
  const r = model.record;
  const {
    host,
    profile,
    productModel,
    kpiInfoTone,
    kpiIfTone,
    kpiPerfTone,
    kpiVlanTone,
    kpiInfoVal,
    kpiIfVal,
    kpiPerfVal,
    kpiVlanVal,
  } = model;

  return [
    {
      key: 'overview',
      label: '概览',
      children: (
        <Descriptions {...SWITCH_PROBE_DESCR_COL1}>
          <Descriptions.Item label="ASW-CTL 名称">
            {r.name != null && String(r.name).trim() ? r.name : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="服务地址">
            {r.baseUrl ? (
              <Typography.Text copyable={{ text: r.baseUrl }} code>
                {r.baseUrl}
              </Typography.Text>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="设备模板">{profile || '—'}</Descriptions.Item>
          <Descriptions.Item label="型号">{productModel || '—'}</Descriptions.Item>
          <Descriptions.Item label="管理地址">
            {host !== '—' ? (
              <Typography.Text copyable={{ text: host }} code>
                {host}
              </Typography.Text>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="服务健康">{serviceHealthTag(r)}</Descriptions.Item>
          <Descriptions.Item label="基本信息">{statusTag(kpiInfoVal, kpiInfoTone)}</Descriptions.Item>
          <Descriptions.Item label="接口状态">{statusTag(kpiIfVal, kpiIfTone)}</Descriptions.Item>
          <Descriptions.Item label="性能探测">{statusTag(kpiPerfVal, kpiPerfTone)}</Descriptions.Item>
          <Descriptions.Item label="VLAN 查询">{statusTag(kpiVlanVal, kpiVlanTone)}</Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'cli',
      label: '系统信息',
      children: (
        <Flex vertical gap="middle">
          {r.healthError ? (
            <Alert
              type="error"
              showIcon
              message={`服务健康探测失败${r.healthHttpStatus ? `（HTTP ${r.healthHttpStatus}）` : ''}`}
              description={`${r.healthPath ? `${r.healthPath}：` : ''}${r.healthError}`}
            />
          ) : null}
          {r.infoError ? (
            <Alert
              type="error"
              showIcon
              message={`基本信息探测失败${r.infoHttpStatus ? `（HTTP ${r.infoHttpStatus}）` : ''}`}
              description={r.infoError}
            />
          ) : null}
          {r.interfacesError ? (
            <Alert
              type="error"
              showIcon
              message={`接口探测失败${r.interfacesHttpStatus ? `（HTTP ${r.interfacesHttpStatus}）` : ''}`}
              description={r.interfacesError}
            />
          ) : null}
          {r.performanceError ? (
            <Alert
              type="error"
              showIcon
              message={`性能探测失败${r.performanceHttpStatus ? `（HTTP ${r.performanceHttpStatus}）` : ''}`}
              description={r.performanceError}
            />
          ) : null}
          {r.vlansError ? (
            <Alert
              type="error"
              showIcon
              message={`VLAN 查询失败${r.vlansHttpStatus ? `（HTTP ${r.vlansHttpStatus}）` : ''}`}
              description={r.vlansError}
            />
          ) : null}

          {r.healthNotApplicable ? (
            <Alert type="info" showIcon message={r.healthNaMessage || '未提供标准健康路径'} />
          ) : r.health != null ? (
            <Collapse
              size="small"
              items={[
                {
                  key: 'health',
                  label: `服务健康（${r.healthPath || 'ok'}）`,
                  children: (
                    <Typography.Paragraph
                      copyable
                      code
                      style={{ marginBottom: 0, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                    >
                      {typeof r.health === 'string' ? r.health : JSON.stringify(r.health, null, 2)}
                    </Typography.Paragraph>
                  ),
                },
              ]}
            />
          ) : null}

          {r.infoError ? null : <AswCliOutputCollapse title="基本信息" lines={r.info?.lines || []} />}
          {r.interfacesError ? null : (
            <AswCliOutputCollapse title="接口状态" lines={r.interfaces?.lines || []} />
          )}
          {r.performanceError ? null : r.performanceNotApplicable ? (
            <Alert type="info" showIcon message={r.performanceNaMessage || '性能探测未配置（HTTP 503）'} />
          ) : (
            <AswCliOutputCollapse title="性能/健康" lines={r.performance?.lines || []} />
          )}

          {r.vlansError ? null : r.vlansNotApplicable ? (
            <Alert
              type="info"
              showIcon
              message={
                r.vlansNaMessage ||
                'HTTP 404：当前服务上无 GET /v1/switch/vlans路由（多为未升级、路径或地址指错）。'
              }
            />
          ) : null}
          {r.vlansError || r.vlansNotApplicable ? null : (
            <AswCliOutputCollapse title="VLAN CLI 回显" lines={r.vlans?.lines || []} />
          )}
        </Flex>
      ),
    },
  ];
}
