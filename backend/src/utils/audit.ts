import { Request } from 'express';

export const logOperation = async (
  req: Request,
  action: string,
  details: string,
  success: boolean = true,
) => {
  const user = (req as any).user;
  const operator = user ? `${user.username} (${user.id})` : 'unknown';
  const time = new Date().toISOString();
  console.log(`[AUDIT] [${time}] [${operator}] [${action}] ${details} [Success: ${success}]`);
  // In a real app, you would save this to a database table like 'audit_logs'
};
