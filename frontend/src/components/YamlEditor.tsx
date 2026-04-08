/**
 * ============================================================================
 * 模块名称: YAML 编辑器 (YamlEditor)
 * 文件路径: src/components/YamlEditor.tsx
 * ============================================================================
 * 
 * [功能描述]
 * 基于 CodeEditor 的 YAML 编辑器组件，支持语法高亮、行号、滚动条、Tab 缩进。
 * 
 * [使用场景]
 * - 编辑 Kubernetes 资源 YAML
 * - 编辑配置文件
 * 
 * [说明]
 * 此组件是 CodeEditor 的 YAML 专用封装，保持向后兼容。
 */

import React from 'react';
import CodeEditor from './CodeEditor';

type Props = {
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  style?: React.CSSProperties;
  className?: string;
  /** Tab 缩进的空格数，默认为 2 */
  tabSize?: number;
};

const YamlEditor: React.FC<Props> = ({
  value,
  onChange,
  readOnly = false,
  placeholder,
  minHeight = 200,
  maxHeight = 500,
  style,
  className,
  tabSize = 2,
}) => {
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      placeholder={placeholder}
      minHeight={minHeight}
      maxHeight={maxHeight}
      style={style}
      className={className}
      tabSize={tabSize}
      language="yaml"
    />
  );
};

export default YamlEditor;