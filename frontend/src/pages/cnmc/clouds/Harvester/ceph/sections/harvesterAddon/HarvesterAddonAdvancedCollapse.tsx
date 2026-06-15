import React from 'react';
import { Collapse, Typography } from 'antd';
import { ADDON_ADVANCED_COLLAPSE_CLASS } from './addonUiConstants';

export type HarvesterAddonAdvancedCollapseProps = {
  children: React.ReactNode;
  /** 展开后内容区顶部说明（可选） */
  description?: string;
};

/** 存储配置向导 · 高级选项折叠（与节点卡片层次一致，避免 ghost + 嵌套 FormSection） */
const HarvesterAddonAdvancedCollapse: React.FC<HarvesterAddonAdvancedCollapseProps> = ({
  children,
  description,
}) => (
  <Collapse
    className={ADDON_ADVANCED_COLLAPSE_CLASS}
    bordered={false}
    defaultActiveKey={[]}
    items={[
      {
        key: 'advanced',
        label: (
          <span className="harvester-addon-advanced-collapse-label">
            <Typography.Text strong>高级选项</Typography.Text>
            <Typography.Text type="secondary">一般保持默认即可</Typography.Text>
          </span>
        ),
        children: (
          <>
            {description ? (
              <Typography.Paragraph type="secondary" className="harvester-addon-advanced-collapse-desc">
                {description}
              </Typography.Paragraph>
            ) : null}
            {children}
          </>
        ),
      },
    ]}
  />
);

export default HarvesterAddonAdvancedCollapse;
