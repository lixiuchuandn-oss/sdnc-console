export const extractRows = (res: any): any[] => {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.list)) return res.list;
  if (Array.isArray(res.rows)) return res.rows;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.items)) return res.items;
  if (Array.isArray(res.page)) return res.page;

  // Handle case where data might be nested in a 'data' property of an axios response
  if (res.data) {
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.data.list)) return res.data.list;
    if (Array.isArray(res.data.rows)) return res.data.rows;
    if (Array.isArray(res.data.items)) return res.data.items;
  }

  return [];
};
