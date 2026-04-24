import React from 'react';
import { Divider, Modal, Space, Tag, Typography } from 'antd';
import type { AppItem } from '../types/app';
import { statusTag, typeTag } from '../components/appDisplayUtils';

const { Text } = Typography;

type Props = {
  open: boolean;
  app: AppItem | null;
  onClose: () => void;
};

const AppDetailModal: React.FC<Props> = ({ open, app, onClose }) => (
  <Modal
    title="应用详情"
    open={open}
    footer={null}
    onCancel={onClose}
    destroyOnClose
    width={720}
  >
    {app && (
      <div style={{ paddingTop: 8 }}>
        <Typography.Title level={5} style={{ marginBottom: 12 }}>
          {app.name}
        </Typography.Title>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <Text type="secondary">安全域</Text>
            <div>{app.domainName || app.domainId}</div>
          </div>
          <div>
            <Text type="secondary">部署类型</Text>
            <div>{typeTag(app.type)}</div>
          </div>
          <div>
            <Text type="secondary">负责人</Text>
            <div>{app.owner || '-'}</div>
          </div>
          <div>
            <Text type="secondary">版本</Text>
            <div>{app.version || '-'}</div>
          </div>
          <div>
            <Text type="secondary">状态</Text>
            <div>{statusTag(app.status)}</div>
          </div>
          <div>
            <Text type="secondary">实例数</Text>
            <div>{app.instanceCount}</div>
          </div>
        </div>
        <Divider />
        <Text type="secondary">描述</Text>
        <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{app.description || '-'}</div>
        <Divider />
        <Text type="secondary">授权策略</Text>
        <div style={{ marginTop: 4 }}>
          <Space wrap>
            {(app.strategies || []).map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </Space>
        </div>
        <Divider />
        <Text type="secondary">包含实例</Text>
        <div style={{ marginTop: 4 }}>
          <Space wrap>
            {(app.instances || []).map((id) => (
              <Tag key={id}>{id}</Tag>
            ))}
          </Space>
        </div>
      </div>
    )}
  </Modal>
);

export default AppDetailModal;
