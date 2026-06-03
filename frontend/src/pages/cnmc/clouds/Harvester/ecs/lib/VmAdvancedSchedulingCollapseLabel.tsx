import React from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

type Props = {
  title: string;
  hint?: string;
};

/** 高级调度折叠项标题；可选说明以 Tooltip 展示 */
export const VmAdvancedSchedulingCollapseLabel: React.FC<Props> = ({ title, hint }) => (
  <span>
    {title}
    {hint ? (
      <Tooltip title={hint}>
        <QuestionCircleOutlined
          style={{ marginLeft: 4, color: 'rgba(0,0,0,.45)', fontSize: 12, cursor: 'help' }}
          onClick={(e) => e.stopPropagation()}
        />
      </Tooltip>
    ) : null}
  </span>
);
