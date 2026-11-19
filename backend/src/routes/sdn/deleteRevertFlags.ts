/** R1：删除路径上「显式关闭回退」的 query 判定。缺省视为要回退。 */

export const queryFlagOff = (raw: unknown): boolean => {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
};
