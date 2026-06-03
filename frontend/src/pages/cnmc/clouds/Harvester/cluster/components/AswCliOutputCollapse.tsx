/**
 * ASW-CTL 探测结果中 lines[] 的折叠展示（cluster 域内复用）。
 */
import React, { useMemo } from 'react';
import { Alert, Collapse, Typography } from 'antd';
import type { AswCtlProbeLine } from 'services/harvester/types/aswProbe';
import {
  formatAswCliLineForDisplay,
  isHsmCliStdoutLikelyTruncated,
  isHsmCliStdoutMissingBody,
} from '../lib/sanitizeAswCliStdout';

export type AswCliOutputCollapseProps = {
  lines: AswCtlProbeLine[];
  title: string;
};

/** 按行渲染，避免 <pre> 内嵌 NUL/CR 时浏览器只显示到命令提示符 */
const CliStdoutBlock: React.FC<{ text: string }> = ({ text }) => {
  const rows = useMemo(() => text.split('\n'), [text]);
  if (!text.trim()) {
    return <Typography.Text type="secondary">（无回显正文）</Typography.Text>;
  }
  return (
    <div
      className="asw-cli-stdout-block"
      style={{
        margin: 0,
        maxHeight: 480,
        overflow: 'auto',
        fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.45,
        background: '#fafafa',
        border: '1px solid #e5e6eb',
        borderRadius: 4,
        padding: '8px 10px',
        color: '#1f2329',
      }}
    >
      {rows.map((ln, idx) => (
        <div
          key={idx}
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            minHeight: ln.length === 0 ? '0.6em' : undefined,
          }}
        >
          {ln}
        </div>
      ))}
    </div>
  );
};

const AswCliOutputCollapse: React.FC<AswCliOutputCollapseProps> = ({ lines, title }) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    return <Typography.Text type="secondary">{title}：无 CLI 输出行</Typography.Text>;
  }
  return (
    <Collapse
      size="small"
      items={lines.map((line, i) => {
        const displayText = formatAswCliLineForDisplay(line);
        return {
          key: String(i),
          label: line.command || `命令 ${i + 1}`,
          children: (
            <>
              {isHsmCliStdoutMissingBody(line.stdout, line.command) ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="回显正文未展示或已被截断"
                  description="探测数据里可能有完整回显，但 H3C 等设备常带不可见控制字符，会导致页面只显示到命令提示符。当前已自动清洗；若仍无正文，请提高命令超时或改用更短命令（如 display interface brief | include XGE）。"
                />
              ) : null}
              {isHsmCliStdoutLikelyTruncated(line.stdout, line.command) ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="CLI 回显可能不完整"
                  description="当前为路由模式 brief，且输出在 Vlan 等逻辑口处被截断，未见 XGE 物理口。建议接口命令改为单行：display interface brief | include XGE，命令超时 60～90 秒，保存后重新探测同步。"
                />
              ) : null}
              <CliStdoutBlock text={displayText} />
            </>
          ),
        };
      })}
    />
  );
};

export default AswCliOutputCollapse;
