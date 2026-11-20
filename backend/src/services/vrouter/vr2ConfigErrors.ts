export type Vr2BizErrorLike = { code?: number; msg?: string } | null | undefined;

export const isVr2MissingBizError = (err: Vr2BizErrorLike): boolean => {
  if (!err) return false;
  if (err.code === 404 || err.code === 5012) return true;
  const msg = String(err.msg ?? '').toLowerCase();
  return (
    msg.includes('不存在') ||
    msg.includes('没有此vr') ||
    msg.includes('没有此 vr') ||
    msg.includes('not found') ||
    msg.includes('no such')
  );
};
