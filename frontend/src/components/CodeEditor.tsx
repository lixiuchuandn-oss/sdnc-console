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
  maxHeight,
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

  const handleChange = (val: string) => {
    onChange?.(val);
  };

  const parsePx = (raw: number | string | undefined): number | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
    if (typeof raw === 'string') {
      const t = raw.trim();
      const px = /^(\d+(?:\.\d+)?)\s*px$/i.exec(t);
      if (px) return Math.max(0, parseFloat(px[1]));
      const n = /^(\d+(?:\.\d+)?)$/.exec(t);
      if (n) return Math.max(0, parseFloat(n[1]));
    }
    return undefined;
  };

  const minPx = parsePx(minHeight) ?? 200;

  let maxPx: number | undefined;
  let maxHeightRawCss: string | undefined;
  if (typeof maxHeight === 'number' && Number.isFinite(maxHeight)) {
    maxPx = Math.max(minPx, maxHeight);
  } else if (typeof maxHeight === 'string') {
    const p = parsePx(maxHeight);
    if (p !== undefined) maxPx = Math.max(minPx, p);
    else if (maxHeight.trim()) maxHeightRawCss = maxHeight.trim();
  }

  const explicitH = parsePx(height);
  const viewportUncapped =
    explicitH !== undefined ? Math.max(minPx, explicitH) : minPx;
  const viewportPx =
    maxPx !== undefined
      ? Math.min(viewportUncapped, maxPx)
      : viewportUncapped;

  const fillsParent =
    typeof style?.flex === 'number' ||
    (typeof style?.height === 'string' && /%|vh|auto/i.test(style.height));

  const mergedStyle: React.CSSProperties = {
    border: '1px solid #d9d9d9',
    borderRadius: 4,
    boxSizing: 'border-box',
    minHeight: minPx,
    ...style,
  };

  if (maxPx !== undefined && mergedStyle.maxHeight === undefined) {
    mergedStyle.maxHeight = maxPx;
  } else if (maxHeightRawCss && mergedStyle.maxHeight === undefined) {
    mergedStyle.maxHeight = maxHeightRawCss;
  }
  if (mergedStyle.maxHeight !== undefined) {
    mergedStyle.overflowY ??= 'auto';
  } else if (!fillsParent || mergedStyle.height === undefined) {
    mergedStyle.overflow ??= 'hidden';
  }

  if (explicitH !== undefined && mergedStyle.height === undefined) {
    mergedStyle.height = explicitH;
  }

  /** 显式传入的 height（数值）一律交给 CodeMirror 像素高度，避免与 style.height 组合误判为 fillsParent→100% 导致无法滚动 */
  const cmHeight =
    explicitH !== undefined && Number.isFinite(explicitH)
      ? `${Math.max(minPx, viewportPx)}px`
      : fillsParent
        ? '100%'
        : `${viewportPx}px`;

  return (
    <div className={className} style={mergedStyle}>
      <CodeMirror
        value={value || ''}
        height={cmHeight}
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
        }}
        theme={cmTheme}
      />
    </div>
  );
};

export default CodeEditor;
