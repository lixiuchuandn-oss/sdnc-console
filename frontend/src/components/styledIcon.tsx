import React from 'react';

const styledIcon = (node: React.ReactNode, size: number, color: string) => {
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
};

export default styledIcon;
