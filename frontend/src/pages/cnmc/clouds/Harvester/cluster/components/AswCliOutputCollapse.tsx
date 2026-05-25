/**
 * ASW-CTL 探测结果中 lines[] 的折叠展示（cluster 域内复用）。
 */
import React from 'react';
import { Collapse, Typography } from 'antd';
import type { AswCtlProbeLine } from 'services/harvester/types/aswProbe';

export type AswCliOutputCollapseProps = {
  lines: AswCtlProbeLine[];
  title: string;
};

const AswCliOutputCollapse: React.FC<AswCliOutputCollapseProps> = ({ lines, title }) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    return <Typography.Text type="secondary">{title}：无 CLI 输出行</Typography.Text>;
  }
  return (
    <Collapse
      size="small"
      items={lines.map((line, i) => ({
        key: String(i),
        label: line.command || `命令 ${i + 1}`,
        children: (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              maxHeight: 360,
              overflow: 'auto',
            }}
          >
            {line.stdout || line.stderr || line.error || ''}
          </pre>
        ),
      }))}
    />
  );
};

export default AswCliOutputCollapse;
