import { Button, Drawer, Input, Space, Typography } from 'antd';
import type { ReactNode } from 'react';

export type ConfigFileDrawerProps = {
	open: boolean;
	onClose: () => void;
	/** 文件名，用于标题，如 nic_roles.conf */
	fileName: string;
	filePath: string;
	hint?: ReactNode;
	loading: boolean;
	editing: boolean;
	error: string | null;
	content: string;
	draft: string;
	emptyText?: string;
	onRefresh: () => void;
	onEdit: () => void;
	onSave: () => void;
	onCancelEdit: () => void;
	onDraftChange: (value: string) => void;
};

export function ConfigFileDrawer(props: ConfigFileDrawerProps) {
	const emptyText = props.emptyText ?? '（空）';

	return (
		<Drawer
			className="app-conf-file-drawer"
			title={`查看配置文件 — ${props.fileName}`}
			width={720}
			open={props.open}
			onClose={props.onClose}
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
						路径：<Typography.Text code>{props.filePath}</Typography.Text>
					</Typography.Paragraph>
					{props.hint != null ? (
						<Typography.Paragraph type="secondary" className="app-conf-drawer-hint">
							{props.hint}
						</Typography.Paragraph>
					) : null}
					<Space wrap className="app-conf-drawer-toolbar">
						<Button loading={props.loading} onClick={props.onRefresh}>
							刷新
						</Button>
						<Button disabled={props.loading} onClick={props.onEdit}>
							编辑
						</Button>
						<Button type="primary" disabled={props.loading || !props.editing} loading={props.loading} onClick={props.onSave}>
							保存
						</Button>
						<Button disabled={props.loading || !props.editing} onClick={props.onCancelEdit}>
							取消
						</Button>
					</Space>
					{props.error ? (
						<Typography.Paragraph type="danger" className="app-conf-drawer-error">
							{props.error}
						</Typography.Paragraph>
					) : null}
				</div>
				<div className="app-conf-drawer-body">
					{props.editing ? (
						<Input.TextArea
							className="app-conf-drawer-textarea"
							value={props.draft}
							onChange={(e) => props.onDraftChange(e.target.value)}
							disabled={props.loading}
						/>
					) : (
						<pre className="app-conf-drawer-preview">{props.content ? props.content : emptyText}</pre>
					)}
				</div>
			</div>
		</Drawer>
	);
}
