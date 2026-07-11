import { Button, Drawer, Typography } from 'antd';

export type BackupFileDrawerProps = {
	open: boolean;
	onClose: () => void;
	fileName: string;
	filePath: string;
	loading?: boolean;
	content: string;
	error?: string | null;
	onRefresh?: () => void;
};

export function BackupFileDrawer({
	open,
	onClose,
	fileName,
	filePath,
	loading = false,
	content,
	error,
	onRefresh,
}: BackupFileDrawerProps) {
	return (
		<Drawer
			className="app-conf-file-drawer"
			title={`备份文件 — ${fileName}`}
			width={840}
			open={open}
			onClose={onClose}
			destroyOnClose={false}
			styles={{
				body: {
					padding: 0,
					overflow: 'hidden',
					display: 'flex',
					flexDirection: 'column',
				},
			}}
		>
			<div className="app-conf-drawer">
				<div className="app-conf-drawer-head">
					<Typography.Paragraph type="secondary" className="app-conf-drawer-path">
						路径：<Typography.Text code>{filePath}</Typography.Text>
					</Typography.Paragraph>
					<Typography.Paragraph type="secondary" className="app-conf-drawer-hint">
						云平台下发后由 agent 存档；只读查看，修改请在 SDN 专家模式操作。
					</Typography.Paragraph>
					{onRefresh ? (
						<Button loading={loading} onClick={onRefresh}>
							刷新
						</Button>
					) : null}
					{error ? (
						<Typography.Paragraph type="danger" className="app-conf-drawer-error">
							{error}
						</Typography.Paragraph>
					) : null}
				</div>
				<div className="app-conf-drawer-body">
					<pre className="app-conf-drawer-preview">{content || '（空）'}</pre>
				</div>
			</div>
		</Drawer>
	);
}
