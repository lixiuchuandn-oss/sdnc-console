export const commonTableStyles = {
  cellContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
  },
  primaryText: {
    fontSize: '14px',
    color: '#000000E0',
  },
  secondaryText: {
    fontSize: '13px',
    color: 'rgba(0, 0, 0, 0.45)',
    lineHeight: '1.6',
  },
  processingText: {
    fontSize: '13px',
    color: '#000000E0',
    lineHeight: '1',
  },
  linkText: {
    fontSize: '13px',
    color: '#1677ff',
    lineHeight: '1.5',
    cursor: 'pointer',
  },
};

export const commonBadgeStyles = {
  statusMap: {
    success: { status: 'success' as const, color: '#52c41a' },
    warning: { status: 'warning' as const, color: '#faad14' },
    error: { status: 'error' as const, color: '#ff4d4f' },
    default: { status: 'default' as const, color: '#d9d9d9' },
    processing: { status: 'processing' as const, color: '#1677ff' },
  },
  text: {
    fontSize: '13px',
    color: '#1f1f1f',
    fontWeight: 400,
  },
};

export const safeParse = (str: any) => {
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
};

export const commonTagStyles = {
  base: {
    fontSize: '12px',
    lineHeight: '20px',
    borderRadius: '4px',
    fontWeight: 400,
  },
};
