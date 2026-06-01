import React from 'react';

export function styledSectionIcon(node: React.ReactNode, size: number, color: string) {
  return React.isValidElement(node)
    ? React.cloneElement(node as any, {
        style: {
          ...((node as any).props?.style || {}),
          fontSize: size,
          color,
          display: 'inline-block',
          verticalAlign: 'middle',
          lineHeight: 1,
        },
      })
    : node;
}

export function createChildNormalizer(options: {
  autoStyleInputs: boolean;
  keywordWidth: number;
  selectWidth: number;
  inputSize: 'small' | 'middle' | 'large';
}) {
  const { autoStyleInputs, keywordWidth, selectWidth, inputSize } = options;

  const normalizeNode = (node: React.ReactNode): React.ReactNode => {
    if (!autoStyleInputs || !React.isValidElement(node)) return node;

    const anyType: any = (node as any).type;
    const name = String(anyType?.displayName || anyType?.name || '').toLowerCase();
    const props: any = (node as any).props || {};
    const style: React.CSSProperties = props.style || {};
    const nextProps: any = { ...props };

    const hasWidth = style && (style as any).width !== undefined;
    const setWidth = (w: number) => {
      if (!hasWidth) nextProps.style = { ...style, width: w };
    };
    const setSize = () => {
      if (props.size === undefined) nextProps.size = inputSize;
    };

    const ph = String(props.placeholder || '').toLowerCase();
    const isKeywordInput =
      name === 'search' ||
      (name === 'input' && (ph.includes('关键字') || ph.includes('搜索') || ph.includes('keyword')));

    if (isKeywordInput) {
      setWidth(keywordWidth);
      setSize();
      if (nextProps.allowClear === undefined) nextProps.allowClear = true;
      if (name === 'search' && nextProps.enterButton !== undefined) nextProps.enterButton = false;
    } else if (name === 'select') {
      setWidth(selectWidth);
      setSize();
    }

    if (name.includes('table')) {
      if (nextProps.size === undefined) nextProps.size = 'middle';
      if (nextProps.bordered === undefined) nextProps.bordered = true;
      if (nextProps.tableLayout === undefined) nextProps.tableLayout = 'auto';
      const cls: string = String(props.className || '').trim();
      const wantMiddle = String(nextProps.size || '').toLowerCase() !== 'small';
      const classes = [cls, wantMiddle ? 'vr-table vr-table--middle' : ''].filter(Boolean).join(' ');
      nextProps.className = classes;
    }

    if (props.children !== undefined) {
      const c = props.children as any;
      if (typeof c === 'function') {
        nextProps.children = c;
      } else if (Array.isArray(c)) {
        nextProps.children = React.Children.map(c, (child: any) => normalizeNode(child));
      } else {
        nextProps.children = normalizeNode(c);
      }
    }
    return React.cloneElement(node as any, nextProps);
  };

  return (children: React.ReactNode): React.ReactNode =>
    React.Children.map(children as any, normalizeNode);
}
