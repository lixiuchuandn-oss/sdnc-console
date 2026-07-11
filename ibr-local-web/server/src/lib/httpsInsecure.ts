/**
 * 与 v1 urllib + ssl.CERT_NONE 对齐：Tower / CSM 常为自签或内网证书。
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export type HttpJsonResult = {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
	json: unknown;
};

function parseJson(body: string): unknown {
	const t = body.trim();
	if (!t) return undefined;
	try {
		return JSON.parse(t) as unknown;
	} catch {
		return undefined;
	}
}

export async function httpRequestJson(
	urlStr: string,
	method: string,
	headers: Record<string, string>,
	body?: string,
	insecureTls = true,
): Promise<HttpJsonResult> {
	const u = new URL(urlStr);
	const isHttps = u.protocol === 'https:';
	const port = u.port || (isHttps ? '443' : '80');
	const pathWithQuery = u.pathname + u.search;
	const agent = isHttps && insecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;

	return new Promise((resolve, reject) => {
		const opts: http.RequestOptions = {
			protocol: u.protocol,
			hostname: u.hostname,
			port,
			path: pathWithQuery,
			method,
			headers,
			agent,
		};
		const lib = isHttps ? https : http;
		const req = lib.request(opts, (res) => {
			let buf = '';
			res.setEncoding('utf8');
			res.on('data', (c) => {
				buf += c;
			});
			res.on('end', () => {
				resolve({
					status: res.statusCode ?? 0,
					headers: res.headers,
					body: buf,
					json: parseJson(buf),
				});
			});
		});
		req.on('error', reject);
		if (body != null && body !== '') req.write(body, 'utf8');
		req.end();
	});
}

export function sleepMs(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
