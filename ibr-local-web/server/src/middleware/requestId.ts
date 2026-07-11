/**
 * 为 `/api/*` 请求分配 trace_id：回显 `X-Request-Id`、写入 `res.locals.traceId`，便于日志与排障。
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
	const incoming = req.get('x-request-id')?.trim();
	const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
	res.locals.traceId = id;
	res.setHeader('x-request-id', id);
	next();
}
