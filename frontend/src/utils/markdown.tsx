import React from 'react';

/**
 * 解析 Markdown 加粗语法，将 *xxx* 渲染为加粗文本
 * @param text - 包含 *xxx* 语法的文本
 * @returns React 节点数组
 */
export const renderMarkdownBold = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 添加加粗前的普通文本
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    // 添加加粗文本
    parts.push(<span key={match.index} style={{ fontWeight: 700 }}>{match[1]}</span>);
    lastIndex = regex.lastIndex;
  }

  // 添加剩余的普通文本
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  // 如果没有匹配到任何加粗语法，返回原文本
  return parts.length > 0 ? parts : [text];
};
