import React from 'react';

/** JSON 字符串简单语法上色（仅 Harvester 运维信息抽屉等少量场景使用） */
const JsonHighlight: React.FC<{ value: string; style?: React.CSSProperties }> = ({ value, style }) => {
  const highlightJson = (json: string): React.ReactNode => {
    const lines = json.split('\n');
    return lines.map((line, lineIndex) => {
      const highlightedLine = highlightLine(line);
      return (
        <div key={lineIndex} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {highlightedLine}
        </div>
      );
    });
  };

  const highlightLine = (line: string): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      if (remaining.startsWith('"') && remaining.match(/^"([^"\\]|\\.)*":/)) {
        const match = remaining.match(/^"([^"\\]|\\.)*":/);
        if (match) {
          result.push(
            <span key={key++} style={{ color: '#922b21' }}>{match[0]}</span>
          );
          remaining = remaining.slice(match[0].length);
        } else {
          result.push(<span key={key++}>{remaining[0]}</span>);
          remaining = remaining.slice(1);
        }
      } else if (remaining.startsWith('"')) {
        const match = remaining.match(/^"([^"\\]|\\.)*"/);
        if (match) {
          result.push(
            <span key={key++} style={{ color: '#1d7a1d' }}>{match[0]}</span>
          );
          remaining = remaining.slice(match[0].length);
        } else {
          result.push(<span key={key++}>{remaining[0]}</span>);
          remaining = remaining.slice(1);
        }
      } else if (remaining.match(/^\d+/)) {
        const match = remaining.match(/^\d+/);
        if (match) {
          result.push(
            <span key={key++} style={{ color: '#1a1aa6' }}>{match[0]}</span>
          );
          remaining = remaining.slice(match[0].length);
        } else {
          result.push(<span key={key++}>{remaining[0]}</span>);
          remaining = remaining.slice(1);
        }
      } else if (remaining.startsWith('true') || remaining.startsWith('false')) {
        const word = remaining.startsWith('true') ? 'true' : 'false';
        result.push(
          <span key={key++} style={{ color: '#1a1aa6' }}>{word}</span>
        );
        remaining = remaining.slice(word.length);
      } else if (remaining.startsWith('null')) {
        result.push(
          <span key={key++} style={{ color: '#808080' }}>null</span>
        );
        remaining = remaining.slice(4);
      } else {
        result.push(<span key={key++}>{remaining[0]}</span>);
        remaining = remaining.slice(1);
      }
    }

    return result;
  };

  return (
    <pre style={{
      margin: 0,
      padding: 0,
      fontSize: 12,
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      overflow: 'visible',
      ...style
    }}>
      {highlightJson(value)}
    </pre>
  );
};

export default JsonHighlight;
