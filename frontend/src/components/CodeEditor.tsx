/**
 * ============================================================================
 * 模块名称: 代码编辑器 (CodeEditor)
 * 文件路径: src/components/CodeEditor.tsx
 * ============================================================================
 * 
 * [功能描述]
 * 基于 CodeMirror 6 的多语言代码编辑器组件，支持语法高亮、行号、滚动条、Tab 缩进。
 * 
 * [支持语言]
 * - YAML (.yaml, .yml)
 * - JSON (.json)
 * - XML (.xml)
 * - Properties (.properties)
 * - INI (.ini, .conf, .cfg)
 * - Shell (.sh, .bash)
 * - 纯文本
 * 
 * [使用场景]
 * - 编辑 Kubernetes 资源 YAML
 * - 编辑 ConfigMap 配置文件
 * - 编辑各种格式的配置
 */

import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { StreamLanguage } from '@codemirror/language';
// @ts-ignore - legacy-modes 类型声明可能需要额外配置
import { properties } from '@codemirror/legacy-modes/mode/properties';
// @ts-ignore
import { toml } from '@codemirror/legacy-modes/mode/toml';
// @ts-ignore
import { shell } from '@codemirror/legacy-modes/mode/shell';

// 支持的语言类型
export type CodeLanguage = 'yaml' | 'json' | 'xml' | 'properties' | 'ini' | 'shell' | 'text';

// 语言选项，用于下拉选择
export const LANGUAGE_OPTIONS = [
  { value: 'yaml', label: 'YAML' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'properties', label: 'Properties' },
  { value: 'ini', label: 'INI' },
  { value: 'shell', label: 'Shell' },
  { value: 'text', label: '纯文本' },
];

// 文件扩展名到语言的映射
const EXTENSION_LANGUAGE_MAP: Record<string, CodeLanguage> = {
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.xml': 'xml',
  '.properties': 'properties',
  '.ini': 'ini',
  '.conf': 'ini',
  '.cfg': 'ini',
  '.sh': 'shell',
  '.bash': 'shell',
};

/**
 * 根据文件名推断语言类型
 * @param filename 文件名（如 app.yaml, config.json）
 * @returns 语言类型
 */
export const detectLanguage = (filename: string): CodeLanguage => {
  if (!filename) return 'text';
  
  const lowerName = filename.toLowerCase();
  
  // 检查扩展名
  for (const [ext, lang] of Object.entries(EXTENSION_LANGUAGE_MAP)) {
    if (lowerName.endsWith(ext)) {
      return lang;
    }
  }
  
  // 检查常见配置文件名
  if (lowerName === 'dockerfile') return 'shell';
  if (lowerName === 'makefile') return 'shell';
  if (lowerName.startsWith('config')) return 'yaml';
  
  return 'text';
};

type Props = {
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  height?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  style?: React.CSSProperties;
  className?: string;
  /** Tab 缩进的空格数，默认为 2 */
  tabSize?: number;
  /** 语言类型，默认自动检测 */
  language?: CodeLanguage;
  /** 文件名，用于自动检测语言 */
  filename?: string;
  /** CodeMirror 主题，默认 light */
  cmTheme?: 'light' | 'dark';
};

const CodeEditor: React.FC<Props> = ({
  value,
  onChange,
  readOnly = false,
  placeholder,
  height,
  minHeight = 200,
  maxHeight = 500,
  style,
  className,
  tabSize = 2,
  language,
  filename,
  cmTheme = 'light',
}) => {
  // 确定语言类型：优先使用显式指定的语言，其次根据文件名推断
  const resolvedLanguage = language || (filename ? detectLanguage(filename) : 'text');

  // 根据语言类型获取 CodeMirror 扩展
  const extensions = useMemo(() => {
    switch (resolvedLanguage) {
      case 'yaml':
        return [yaml()];
      case 'json':
        return [json()];
      case 'xml':
        return [xml()];
      case 'properties':
        return [StreamLanguage.define(properties)];
      case 'ini':
        // INI 类似 TOML 格式
        return [StreamLanguage.define(toml)];
      case 'shell':
        return [StreamLanguage.define(shell)];
      case 'text':
      default:
        return [];
    }
  }, [resolvedLanguage]);

  // 处理内容变化
  const handleChange = (val: string) => {
    onChange?.(val);
  };

  // 处理高度值，支持数字和字符串
  const formatHeight = (height: number | string | undefined): string => {
    if (!height) return 'auto';
    if (typeof height === 'string') return height;
    return `${height}px`;
  };

  return (
    <div 
      className={className} 
      style={{ 
        border: '1px solid #d9d9d9', 
        borderRadius: 4, 
        overflow: 'hidden',
        height: style?.height || (style?.flex ? '100%' : undefined),
        ...style 
      }}
    >
      <CodeMirror
        value={value || ''}
        height="100%"
        extensions={extensions}
        onChange={handleChange}
        editable={!readOnly}
        placeholder={placeholder}
        indentWithTab={tabSize > 0}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          foldGutter: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
        style={{
          fontSize: 13,
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          height: '100%',
        }}
        theme={cmTheme}
      />
    </div>
  );
};

export default CodeEditor;
