import React from 'react';
import { useIbrEmbedContext, type IbrEmbedContext } from './useIbrEmbedContext';
import type { IbrSectionEmbedProps } from './embedProps';

type Props = {
  children: React.ReactElement<IbrSectionEmbedProps & Partial<IbrEmbedContext>>;
};

/** 将 URL 嵌入参数注入 IBR 页面（Tower iframe 深链） */
const IbrEmbedOutlet: React.FC<Props> = ({ children }) => {
  const ctx = useIbrEmbedContext(children.props);
  return React.cloneElement(children, { ...ctx, ...children.props });
};

export default IbrEmbedOutlet;
