import { RightOutlined } from '@ant-design/icons';
import { Button, Empty, List, Tabs, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { BackupFileDrawer } from '../../components/BackupFileDrawer';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';

const MODULE_LABELS: Record<string, string> = {
	vrf: 'VRF',
	ipv4_route: 'IPv4 路由',
	ipv4_routes: 'IPv4 路由',
	ipv6_route: 'IPv6 路由',
	ipv6_routes: 'IPv6 路由',
	ip_prefix_list: 'Prefix-list',
	route_map: 'Route-map',
	segment_routing_srv6: 'SRv6',
	bgp: 'BGP',
	vrrp: 'VRRP',
	ipsec: 'IPsec',
	acl: 'ACL',
	interfaces: '接口',
	report_config_status: '下发状态',
};

type BackupFile = {
	filename: string;
	content?: unknown;
	raw?: string;
	error?: string;
};

function JsonBlock({ data }: { data: unknown }) {
	return <pre className="app-code-block app-code-block-inset app-code-block-tall">{JSON.stringify(data, null, 2)}</pre>;
}

function resolveEmptyReason(files: BackupFile[], messageText: string | null): string {
	if (files.length === 0) {
		return messageText ?? '暂无配置备份。';
	}
	for (const f of files) {
		const c = f.content;
		if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
		const o = c as Record<string, unknown>;
		if (typeof o.msg !== 'string') continue;
		if (o.msg === '没有此VR配置') {
			return 'SDN 控制器尚未下发配置策略。';
		}
		if (typeof o.code === 'number' && o.code !== 0) {
			return o.msg;
		}
	}
	return '暂无已下发的模块配置。';
}

function formatBackupContent(file: BackupFile | null): string {
	if (!file) return '';
	if (file.error) return `解析失败：${file.error}`;
	if (file.raw?.trim()) {
		try {
			return JSON.stringify(JSON.parse(file.raw), null, 2);
		} catch {
			return file.raw;
		}
	}
	if (file.content !== undefined && file.content !== null) {
		return JSON.stringify(file.content, null, 2);
	}
	return '';
}

const DOWNLOAD_DIR = '/rhos/etc/agent/download';

export function CloudConfigPage() {
	const [loading, setLoading] = useState(false);
	const [modules, setModules] = useState<Record<string, unknown[]>>({});
	const [files, setFiles] = useState<BackupFile[]>([]);
	const [messageText, setMessageText] = useState<string | null>(null);
	const [drawerFile, setDrawerFile] = useState<BackupFile | null>(null);

	const loadCfg = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{
				modules?: Record<string, unknown[]>;
				config?: BackupFile[];
				message?: string;
			}>('/forwarding/config/structured');
			setModules(data.modules ?? {});
			setFiles(data.config ?? []);
			setMessageText(data.message ?? null);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载配置失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadCfg();
	}, [loadCfg]);

	const moduleKeys = useMemo(() => Object.keys(modules).sort(), [modules]);
	const moduleEmptyDescription = useMemo(
		() => resolveEmptyReason(files, messageText),
		[files, messageText],
	);

	const tabItems = useMemo(
		() =>
			moduleKeys.map((k) => ({
				key: k,
				label: `${MODULE_LABELS[k] ?? k} (${modules[k]?.length ?? 0})`,
				children: <JsonBlock data={modules[k]} />,
			})),
		[moduleKeys, modules],
	);

	const drawerContent = useMemo(() => formatBackupContent(drawerFile), [drawerFile]);

	return (
		<PageStack>
			<PageHeader title="配置概览" description="查看云平台下发的各模块配置备份。" />

			<ContentBlock>
				<BlockHeader
					title="云平台配置"
					action={
						<Button type="primary" loading={loading} onClick={() => void loadCfg()}>
							重新加载
						</Button>
					}
				/>
				<Card variant="padded">
					{moduleKeys.length > 0 ? (
						<Tabs items={tabItems} />
					) : (
						<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={moduleEmptyDescription} />
					)}
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="备份文件" />
				<Card variant="list">
					{files.length > 0 ? (
						<List
							split
							className="app-settings-list"
							dataSource={files}
							renderItem={(file) => (
								<List.Item
									key={file.filename}
									className="app-settings-list-item-clickable"
									onClick={() => setDrawerFile(file)}
									extra={<RightOutlined className="app-settings-list-chevron" aria-hidden />}
								>
									<span className="app-settings-list-filename">{file.filename}</span>
								</List.Item>
							)}
						/>
					) : (
						<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无备份文件" />
					)}
				</Card>
			</ContentBlock>

			<BackupFileDrawer
				open={drawerFile != null}
				onClose={() => setDrawerFile(null)}
				fileName={drawerFile?.filename ?? ''}
				filePath={drawerFile ? `${DOWNLOAD_DIR}/${drawerFile.filename}` : DOWNLOAD_DIR}
				loading={loading}
				content={drawerContent}
				error={drawerFile?.error ?? null}
				onRefresh={() => void loadCfg()}
			/>
		</PageStack>
	);
}
