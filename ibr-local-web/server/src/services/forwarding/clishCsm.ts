/**
 * 与 vrlocalctl forwarding 一致：clish（konfd）与 csm_agent_cmd_exector.sh JSON 调用。
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { getPaths, type Paths } from '../../vrwizard.js';

const execFileAsync = promisify(execFile);

const CLISH = '/rhos/bin/clish';
const KONF_SOCKET = '/tmp/konfd.socket';
const ENABLE_VIEW = '/rhos/etc/cli/enable-view';

export function isForwardingMock(paths: Paths): boolean {
	return Boolean(paths.base) || process.platform === 'win32';
}

function rhosEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	env.PATH = `/rhos/bin:${env.PATH ?? ''}`;
	const rhosLib = '/rhos/lib';
	const cur = env.LD_LIBRARY_PATH ?? '';
	env.LD_LIBRARY_PATH = cur ? `${rhosLib}:${cur}` : rhosLib;
	return env;
}

const ansiRe = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(s: string): string {
	return s.replace(ansiRe, '');
}

let csmBinResolved: string | null = null;

export function csmIfnameForScript(ifname: string): string {
	const m = /^([A-Za-z]+)(\d+\/\d+\/\d+)$/.exec(ifname.trim());
	if (m) return `${m[1]} ${m[2]}`;
	return ifname;
}

export function resolveCsmAgentBin(): string {
	if (csmBinResolved) return csmBinResolved;
	const envVal = process.env.VRWIZARD_CSM_AGENT_BIN?.trim();
	const candidates = [envVal, 'csm_agent_cmd_exector.sh', '/rhos/bin/csm_agent_cmd_exector.sh', '/usr/local/bin/csm_agent_cmd_exector.sh'].filter(
		(x): x is string => Boolean(x),
	);
	for (const c of candidates) {
		if (path.isAbsolute(c) && fs.existsSync(c)) {
			csmBinResolved = c;
			return c;
		}
	}
	try {
		const which = execFileSync('/bin/bash', ['-lc', 'command -v csm_agent_cmd_exector.sh'], {
			encoding: 'utf8',
			timeout: 3000,
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
		if (which && fs.existsSync(which)) {
			csmBinResolved = which;
			return which;
		}
	} catch {
		/* ignore */
	}
	throw new Error('未找到 csm_agent_cmd_exector.sh，请配置 VRWIZARD_CSM_AGENT_BIN 或调整 PATH');
}

export type ClishResult = { ok: true; output: string } | { ok: false; error: string; output?: string };

const clishOutputErrorRes = [
	/Syntax error/i,
	/Unknown command/i,
	/Illegal command/i,
	/Illegal parameter/i,
	/is not existed/i,
	/is null/i,
	/% Invalid/i,
];

/** clish 常返回 exit 0 但 stdout 含语义错误（stdin 模式尤其明显）。 */
export function detectClishOutputError(output: string): string | null {
	for (const line of stripAnsi(output).split('\n')) {
		const t = line.trim();
		if (!t) continue;
		for (const re of clishOutputErrorRes) {
			if (re.test(t)) return t;
		}
	}
	return null;
}

function finalizeClishResult(res: ClishResult): ClishResult {
	if (!res.ok) return res;
	const semantic = detectClishOutputError(res.output);
	if (semantic) return { ok: false, error: semantic, output: res.output };
	return res;
}

/** `-c context` + `-c subcmd`（与 agent lua 脚本一致）。 */
export async function runClishContextCommand(contextCmd: string, subCmd: string, paths: Paths): Promise<ClishResult> {
	return finalizeClishResult(await runClishArgv(['-c', contextCmd, '-c', subCmd], paths));
}

/** 单条 configure-view 命令。 */
export async function runClishSingleCommand(cmd: string, paths: Paths, opts?: { timeoutMs?: number }): Promise<ClishResult> {
	return finalizeClishResult(await runClishArgv(['-c', cmd], paths, opts));
}

/** configure-view，多行命令经 stdin 传入（与 Python _run_clish_cmds 一致）。 */
export function runClishStdin(commands: string, paths: Paths): Promise<ClishResult> {
	if (isForwardingMock(paths)) {
		return Promise.resolve({ ok: true, output: commands });
	}
	if (!fs.existsSync(CLISH)) {
		return Promise.resolve({ ok: false, error: `Executable not found: ${CLISH}` });
	}
	const args = ['-x', ENABLE_VIEW, '-w', 'configure-view', '--lock', '--log', `--socket=${KONF_SOCKET}`];
	return new Promise((resolve) => {
		let settled = false;
		const finish = (r: ClishResult) => {
			if (settled) return;
			settled = true;
			resolve(r);
		};
		const proc = spawn(CLISH, args, { env: rhosEnv(), windowsHide: true });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			proc.kill('SIGKILL');
			finish({ ok: false, error: 'clish timeout (30s)', output: stripAnsi(stdout) });
		}, 30_000);
		proc.stdout?.setEncoding('utf8');
		proc.stderr?.setEncoding('utf8');
		proc.stdout?.on('data', (c: string) => {
			stdout += c;
		});
		proc.stderr?.on('data', (c: string) => {
			stderr += c;
		});
		proc.on('error', (err) => {
			clearTimeout(timer);
			finish({ ok: false, error: err.message, output: stripAnsi(stdout) });
		});
		proc.on('close', (code) => {
			clearTimeout(timer);
			const out = stripAnsi(stdout + stderr);
			if (code !== 0) {
				finish({ ok: false, error: `Command failed (Exit ${code}): ${stderr || ''}`, output: out });
				return;
			}
			finish(finalizeClishResult({ ok: true, output: out }));
		});
		try {
			proc.stdin?.end(commands, 'utf8');
		} catch (e) {
			clearTimeout(timer);
			finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
		}
	});
}

/** 单条 -c 命令（如 do show ip route）。 */
export async function runClishArgv(
	argv: string[],
	paths: Paths,
	opts?: { timeoutMs?: number },
): Promise<ClishResult> {
	if (isForwardingMock(paths)) {
		return { ok: true, output: mockShowIpRoute() };
	}
	if (!fs.existsSync(CLISH)) {
		return { ok: false, error: `Executable not found: ${CLISH}. Please check VBRAS installation.` };
	}
	const args = ['--lock', '--log', '-x', ENABLE_VIEW, '-w', 'configure-view', `--socket=${KONF_SOCKET}`, ...argv];
	try {
		const { stdout, stderr } = await execFileAsync(CLISH, args, {
			encoding: 'utf8',
			timeout: opts?.timeoutMs ?? 8000,
			maxBuffer: 20_000_000,
			env: rhosEnv(),
			windowsHide: true,
		});
		const out = stripAnsi(typeof stdout === 'string' ? stdout : String(stdout));
		return finalizeClishResult({ ok: true, output: out });
	} catch (e) {
		const err = e as Error & { stdout?: string; stderr?: string; code?: number };
		let errMsg = err.message || String(e);
		const out = err.stdout ? stripAnsi(err.stdout) : '';
		if (err.stderr) errMsg += `\nOutput: ${String(err.stderr)}`;
		if (out) errMsg += `\nOutput: ${out}`;
		if (err.code === 127) {
			try {
				const ls = execFileSync('ls', ['-l', CLISH], { encoding: 'utf8', timeout: 2000, env: rhosEnv() });
				errMsg += `\nDEBUG ls: ${ls}`;
			} catch {
				/* ignore */
			}
		}
		return { ok: false, error: errMsg, output: out || undefined };
	}
}

function mockShowIpRoute(): string {
	return `
Codes: K - kernel, C - connected, S - static, R - RIP, B - BGP
       O - OSPF, IA - OSPF inter area
       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2
       E1 - OSPF external type 1, E2 - OSPF external type 2
       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2
       ia - IS-IS inter area, * - candidate default

C       127.0.0.0/8 is directly connected, lo
C       192.168.1.0/24 is directly connected, eth0
S*      0.0.0.0/0 [1/0] via 192.168.1.1, eth0
O       10.0.0.0/8 [110/10] via 192.168.1.254, eth0, 00:01:23
`.trim();
}

export type CsmResult = { ok: true; output: string } | { ok: false; error: string; output?: string };

export async function runCsmSteps(
	steps: Array<{ opt: string; args: Record<string, unknown> }>,
	paths: Paths,
): Promise<CsmResult> {
	const outputs: string[] = [];
	for (const step of steps) {
		const r = await runCsmScript(step, paths);
		if (r.output) outputs.push(r.output);
		if (!r.ok) return { ok: false, error: r.error, output: outputs.join('\n') };
	}
	return { ok: true, output: outputs.join('\n') };
}

export function parseCsmJsonError(output: string): string | null {
	try {
		const resData = JSON.parse(output) as Record<string, unknown>;
		if (resData.status === -1 || resData.success === false) {
			return typeof resData.message === 'string' ? resData.message : 'Unknown error from CSM Agent';
		}
		const data = resData.data;
		if (Array.isArray(data) && data.length > 0) {
			const first = data[0] as Record<string, unknown>;
			if (first?.status === -1) {
				const d = first.data ?? first.message;
				return typeof d === 'string' ? d : 'Error in nested command';
			}
		}
	} catch {
		const m = /\{[\s\S]*\}/.exec(output);
		if (m) {
			try {
				return parseCsmJsonError(m[0]!);
			} catch {
				/* ignore */
			}
		}
	}
	return null;
}

export async function runCsmScript(payload: Record<string, unknown>, paths: Paths): Promise<CsmResult> {
	if (isForwardingMock(paths)) {
		return { ok: true, output: JSON.stringify({ ok: true, mock: true, opt: payload.opt }) };
	}
	const scriptPath = resolveCsmAgentBin();
	const jsonStr = JSON.stringify(payload);
	const env = rhosEnv();
	if (path.isAbsolute(scriptPath)) {
		const binDir = path.dirname(scriptPath);
		env.PATH = `${binDir}${path.delimiter}${env.PATH ?? ''}`;
	}
	const parent = path.dirname(path.dirname(scriptPath));
	for (const sub of ['lib', 'lib64']) {
		const cand = path.join(parent, sub);
		if (fs.existsSync(cand)) {
			const cur = env.LD_LIBRARY_PATH ?? '';
			env.LD_LIBRARY_PATH = cur ? `${cand}${path.delimiter}${cur}` : cand;
		}
	}
	try {
		const { stdout, stderr } = await execFileAsync(scriptPath, [jsonStr], {
			encoding: 'utf8',
			timeout: 15_000,
			maxBuffer: 20_000_000,
			env,
			windowsHide: true,
		});
		const output = (typeof stdout === 'string' ? stdout : String(stdout)) + (stderr ? String(stderr) : '');
		const err = parseCsmJsonError(output);
		if (err) return { ok: false, error: err, output };
		return { ok: true, output };
	} catch (e) {
		const err = e as Error & { stdout?: string };
		const out = err.stdout?.toString?.() ?? '';
		let msg = `Command failed: ${err.message || String(e)}`;
		if (out) msg += `\nOutput: ${out}`;
		return { ok: false, error: msg, output: out };
	}
}
