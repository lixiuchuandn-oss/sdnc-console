import React, { useMemo, useRef } from 'react';

type Props = {
  value: string;
  onChange?: (val: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
};

const LinedTextArea: React.FC<Props> = ({
  value,
  onChange,
  readOnly,
  placeholder,
  minRows = 6,
  maxRows = 24,
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

  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className="lined-textarea">
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
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
};

export default LinedTextArea;