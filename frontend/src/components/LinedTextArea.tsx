import React, { useMemo, useRef } from 'react';

type Props = {
  value: string;
  onChange?: (val: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  style?: React.CSSProperties;
  className?: string;
  /** Tab 缩进的空格数，默认为 2。设为 0 则禁用 Tab 缩进 */
  tabSize?: number;
};

const LinedTextArea: React.FC<Props> = ({
  value,
  onChange,
  readOnly,
  placeholder,
  minRows = 6,
  maxRows = 24,
  style,
  className,
  tabSize = 2,
}) => {
  const lineCount = useMemo(() => (value ? value.split('\n').length : 1), [value]);
  const rows = useMemo(() => Math.min(Math.max(lineCount, minRows), maxRows), [lineCount, minRows, maxRows]);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (taRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value);
  };

  // 处理 Tab 键缩进
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (tabSize === 0 || readOnly) return;

    const textarea = taRef.current;
    if (!textarea) return;

    if (e.key === 'Tab') {
      e.preventDefault();

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const spaces = ' '.repeat(tabSize);

      // 如果有选中内容
      if (start !== end) {
        const beforeSelection = value.substring(0, start);
        const selection = value.substring(start, end);
        const afterSelection = value.substring(end);

        // 获取选中内容的行首位置
        const lineStartIndex = beforeSelection.lastIndexOf('\n') + 1;
        const textBeforeLineStart = value.substring(0, lineStartIndex);

        if (e.shiftKey) {
          // Shift+Tab: 减少缩进
          const lines = selection.split('\n');
          const unindentedLines = lines.map(line => {
            // 移除行首的空格（最多移除 tabSize 个）
            let removeCount = 0;
            for (let i = 0; i < Math.min(tabSize, line.length); i++) {
              if (line[i] === ' ') {
                removeCount++;
              } else {
                break;
              }
            }
            return line.substring(removeCount);
          });
          const newValue = textBeforeLineStart + unindentedLines.join('\n') + afterSelection;
          onChange?.(newValue);

          // 恢复选中状态
          setTimeout(() => {
            textarea.selectionStart = lineStartIndex;
            textarea.selectionEnd = lineStartIndex + unindentedLines.join('\n').length;
          }, 0);
        } else {
          // Tab: 增加缩进
          const lines = selection.split('\n');
          const indentedLines = lines.map(line => spaces + line);
          const newValue = textBeforeLineStart + indentedLines.join('\n') + afterSelection;
          onChange?.(newValue);

          // 恢复选中状态
          setTimeout(() => {
            textarea.selectionStart = lineStartIndex;
            textarea.selectionEnd = lineStartIndex + indentedLines.join('\n').length;
          }, 0);
        }
      } else {
        // 没有选中内容，直接插入空格
        if (e.shiftKey) {
          // Shift+Tab: 减少当前行的缩进
          const lineStartIndex = value.lastIndexOf('\n', start - 1) + 1;
          const lineContent = value.substring(lineStartIndex, start);

          let removeCount = 0;
          for (let i = 0; i < Math.min(tabSize, lineContent.length); i++) {
            if (lineContent[i] === ' ') {
              removeCount++;
            } else {
              break;
            }
          }

          if (removeCount > 0) {
            const newValue = value.substring(0, lineStartIndex) + value.substring(lineStartIndex + removeCount);
            onChange?.(newValue);

            // 恢复光标位置
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = start - removeCount;
            }, 0);
          }
        } else {
          // Tab: 在当前位置插入空格
          const newValue = value.substring(0, start) + spaces + value.substring(end);
          onChange?.(newValue);

          // 恢复光标位置
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + tabSize;
          }, 0);
        }
      }
    }
  };

  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className={`lined-textarea ${className || ''}`} style={style}>
      <div className="lined-textarea-gutter" ref={gutterRef}>
        {lines.map((n) => (
          <div key={n} className="lined-textarea-line">{n}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        className="lined-textarea-input"
        rows={rows}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
};

export default LinedTextArea;