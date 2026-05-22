import React from 'react';
import { Button, Card, Space, Tag, Typography } from 'antd';
import { MessageOutlined, PlayCircleOutlined, StarOutlined } from '@ant-design/icons';
import type { XinferenceModelRegistration } from '../../../../../services/xinferenceApi';
import { ABILITY_LABELS, fmtContextLength } from '../lib/xinferenceModelRegistry';

type Props = {
  item: XinferenceModelRegistration;
  running?: boolean;
  cached?: boolean;
  cachedVersionCount?: number;
  onLaunch: () => void;
  onDetail?: () => void;
};

/** 与 Paragraph ellipsis rows 一致，保证各卡片描述区等高 */
const DESC_ROWS = 3;
const DESC_LINE_HEIGHT_PX = 20;
const DESC_BLOCK_HEIGHT = DESC_LINE_HEIGHT_PX * DESC_ROWS;

const ModelRegistrationCard: React.FC<Props> = ({
  item,
  running,
  cached,
  cachedVersionCount,
  onLaunch,
  onDetail,
}) => {
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
        {cached ? (
          <Tag color="cyan" style={{ margin: 0, borderRadius: 999 }}>
            已缓存
            {cachedVersionCount != null && cachedVersionCount > 1
              ? ` · ${cachedVersionCount}版`
              : ''}
          </Tag>
        ) : null}
      </Space>

      <div
        style={{
          height: DESC_BLOCK_HEIGHT,
          marginBottom: 8,
          overflow: 'hidden',
        }}
      >
        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: DESC_ROWS, expandable: false }}
          style={{
            marginBottom: 0,
            fontSize: 13,
            lineHeight: `${DESC_LINE_HEIGHT_PX}px`,
          }}
        >
          {desc}
        </Typography.Paragraph>
      </div>

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
        {ctx ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {ctx}
          </Typography.Text>
        ) : null}
        <Space size={4} style={ctx ? undefined : { marginLeft: 'auto' }}>
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
