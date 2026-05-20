import React from 'react';
import { Button, Card, Space, Tag, Typography } from 'antd';
import { MessageOutlined, PlayCircleOutlined, StarOutlined } from '@ant-design/icons';
import type { XinferenceModelRegistration } from '../../../../../services/xinferenceApi';
import { ABILITY_LABELS, fmtContextLength } from '../lib/xinferenceModelRegistry';

type Props = {
  item: XinferenceModelRegistration;
  running?: boolean;
  onLaunch: () => void;
  onDetail?: () => void;
};

const ModelRegistrationCard: React.FC<Props> = ({ item, running, onLaunch, onDetail }) => {
  const ctx = fmtContextLength(item.contextLength);
  const desc = item.description?.trim() || '暂无描述';

  return (
    <Card
      size="small"
      hoverable
      styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', minHeight: 220 } }}
      style={{ height: '100%', borderRadius: 10 }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Typography.Text strong style={{ fontSize: 16, lineHeight: 1.3 }} ellipsis={{ tooltip: item.modelName }}>
          {item.modelName}
        </Typography.Text>
        <StarOutlined style={{ color: '#cbd5e1', fontSize: 16, flexShrink: 0 }} />
      </div>

      <Space size={[4, 4]} wrap style={{ marginBottom: 10 }}>
        {item.abilities.slice(0, 6).map((a) => (
          <Tag key={a} style={{ margin: 0, borderRadius: 999 }}>
            {ABILITY_LABELS[a] ?? a}
          </Tag>
        ))}
        {item.languages.slice(0, 4).map((lang) => (
          <Tag key={lang} color="blue" style={{ margin: 0, borderRadius: 999 }}>
            {lang}
          </Tag>
        ))}
        {running ? (
          <Tag color="success" style={{ margin: 0, borderRadius: 999 }}>
            运行中
          </Tag>
        ) : null}
      </Space>

      <Typography.Paragraph
        type="secondary"
        ellipsis={{ rows: 3, expandable: false }}
        style={{ flex: 1, marginBottom: 8, fontSize: 13 }}
      >
        {desc}
      </Typography.Paragraph>

      {onDetail ? (
        <Button type="link" size="small" style={{ padding: 0, height: 'auto', alignSelf: 'flex-start' }} onClick={onDetail}>
          更多详情
        </Button>
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
          paddingTop: 12,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {ctx || '—'}
        </Typography.Text>
        <Space size={4}>
          <MessageOutlined style={{ color: '#94a3b8' }} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.modelType === 'LLM' || !item.modelType ? '聊天模型' : item.modelType}
          </Typography.Text>
        </Space>
      </div>

      <Button
        type="primary"
        block
        icon={<PlayCircleOutlined />}
        style={{ marginTop: 12 }}
        onClick={onLaunch}
      >
        启动
      </Button>
    </Card>
  );
};

export default ModelRegistrationCard;
