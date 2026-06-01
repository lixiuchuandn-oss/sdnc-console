import React from 'react';
import { Card, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleFilled, HddOutlined, LockOutlined } from '@ant-design/icons';
import {
  blockDeviceDriveKindIconColor,
  blockDeviceDriveKindLabel,
  blockDeviceDriveKindTagColor,
  blockDeviceOptionTooltip,
  formatBlockDeviceStorageController,
  normalizeDeviceNames,
  resolveBlockDeviceDriveKind,
  type CephBlockDeviceOption,
} from '../../lib/cephHarvesterAddon';

type BlockDeviceCardGridProps = {
  options: CephBlockDeviceOption[];
  disabled?: boolean;
  lockedDevices?: Set<string>;
  value?: string[];
  onChange?: (checked: string[]) => void;
};

const BlockDeviceCardGrid: React.FC<BlockDeviceCardGridProps> = ({
  options,
  disabled,
  lockedDevices,
  value,
  onChange,
}) => {
  const normalizedValue = normalizeDeviceNames(value);
  const locked = lockedDevices ?? new Set<string>();

  const toggle = (deviceValue: string) => {
    if (disabled) return;
    const isLocked = locked.has(deviceValue) && normalizedValue.includes(deviceValue);
    if (isLocked) return;

    const selected = normalizedValue.includes(deviceValue);
    const next = selected
      ? normalizedValue.filter((name) => name !== deviceValue)
      : [...normalizedValue, deviceValue];
    onChange?.(normalizeDeviceNames(next));
  };

  if (options.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        该节点暂无可用于构建存储的硬盘，请确认已挂载数据盘或刷新列表
      </Typography.Text>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 12,
      }}
    >
      {options.map((opt) => {
        const pathLabel = opt.devPath || (opt.value ? `/dev/${opt.value}` : opt.value);
        const driveKind = resolveBlockDeviceDriveKind(opt);
        const meta = [
          opt.sizeLabel,
          formatBlockDeviceStorageController(opt.storageController),
          opt.model,
          opt.serialNumber ? `SN ${opt.serialNumber}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const isSelected = normalizedValue.includes(opt.value);
        const isLocked = locked.has(opt.value) && isSelected;
        const cardDisabled = disabled || (isLocked && isSelected);

        return (
          <Tooltip
            key={opt.blockDeviceCrName || `${opt.nodeName}:${opt.value}:${opt.devPath}`}
            title={blockDeviceOptionTooltip(opt)}
            placement="topLeft"
            styles={{
              body: {
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxWidth: 400,
              },
            }}
          >
            <Card
              size="small"
              hoverable={!cardDisabled}
              onClick={() => toggle(opt.value)}
              style={{
                cursor: cardDisabled ? 'not-allowed' : 'pointer',
                borderColor: isSelected ? '#1677ff' : undefined,
                background: isSelected ? 'rgba(22, 119, 255, 0.04)' : undefined,
                opacity: disabled && !isSelected ? 0.72 : 1,
              }}
              styles={{ body: { padding: '12px 14px' } }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <HddOutlined
                  style={{
                    fontSize: 20,
                    marginTop: 2,
                    color: blockDeviceDriveKindIconColor(driveKind, isSelected),
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Typography.Text strong ellipsis style={{ maxWidth: '100%' }}>
                      {pathLabel}
                    </Typography.Text>
                    {driveKind !== 'unknown' ? (
                      <Tag color={blockDeviceDriveKindTagColor(driveKind)} style={{ margin: 0 }}>
                        {blockDeviceDriveKindLabel(driveKind)}
                      </Tag>
                    ) : null}
                    {isLocked ? (
                      <Tag icon={<LockOutlined />} color="default" style={{ margin: 0 }}>
                        已部署
                      </Tag>
                    ) : null}
                    {isSelected && !isLocked ? (
                      <CheckCircleFilled style={{ color: '#1677ff', fontSize: 14 }} />
                    ) : null}
                  </div>
                  {meta ? (
                    <Typography.Text
                      type="secondary"
                      style={{ display: 'block', fontSize: 12, marginTop: 4, lineHeight: 1.45 }}
                    >
                      {meta}
                    </Typography.Text>
                  ) : null}
                </div>
              </div>
            </Card>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default BlockDeviceCardGrid;
