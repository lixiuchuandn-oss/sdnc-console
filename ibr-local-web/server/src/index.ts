/**
 * HTTP 入口：`/api/public/*` 健康检查；`/api/*` 挂 SSO + 业务路由；可选托管 `web/dist` SPA。
 */
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestIdMiddleware } from './middleware/requestId.js';
import { ssoAuthMiddleware } from './middleware/sso.js';
import { apiRouter } from './routes/api.js';
import { scheduleManagementIpReporting } from './lib/managementIpReporter.js';
import { createPublicAccountRouter } from './routes/publicAccountRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
	dotenv.config({ path: path.resolve(__dirname, '../.env') });
	dotenv.config({ path: path.resolve(__dirname, '../../.env') });

	const app = express();
	const port = Number(process.env.PORT ?? 3000);
	const listenHost = process.env.LISTEN_HOST?.trim() || '0.0.0.0';

	app.use(cors({ origin: true, credentials: true }));
	app.use(express.json({ limit: '256kb' }));

	const publicRouter = express.Router();
	publicRouter.get('/health', (_req, res) => {
		res.json({ ok: true, service: 'paas-vr-console' });
	});
	publicRouter.use('/account', createPublicAccountRouter());
	app.use('/api/public', publicRouter);

	app.use('/api', requestIdMiddleware, ssoAuthMiddleware, apiRouter());

	const webDist = process.env.WEB_DIST
		? path.resolve(process.cwd(), process.env.WEB_DIST)
		: path.resolve(__dirname, '../../web/dist');

	if (fs.existsSync(webDist)) {
		app.use(express.static(webDist));
		app.get('*', (_req, res) => {
			res.sendFile(path.join(webDist, 'index.html'));
		});
	}

	app.use(
		(
			err: Error & { status?: number },
			_req: express.Request,
			res: express.Response,
			_next: express.NextFunction,
		) => {
			const traceId = typeof res.locals.traceId === 'string' ? res.locals.traceId : undefined;
			console.error(traceId ? `[${traceId}]` : '', err);
			res.status(err.status ?? 500).json({
				error: err.message || '服务器错误',
				...(traceId ? { trace_id: traceId } : {}),
			});
		},
	);

	app.listen(port, listenHost, () => {
		console.log(`Server http://${listenHost}:${port}`);
		if (!fs.existsSync(webDist)) {
			console.warn('未找到 WEB_DIST，仅 API 模式。请先构建 web 或设置 WEB_DIST。');
		}
		scheduleManagementIpReporting();
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
