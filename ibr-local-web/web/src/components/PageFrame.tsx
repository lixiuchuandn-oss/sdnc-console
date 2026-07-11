import { Card, Space, Typography } from 'antd';
import type { CardProps } from 'antd';
import type { ReactNode } from 'react';

/**
 * 控制台内容区统一版式：顶栏标题与 `extra`、说明、`toolbar`、主内容（可选整块 Card）。
 * - 说明下的主/次按钮用 `toolbar`（如资产列表「同步 + 刷新」）。
 * - `contentCard`：整块白底卡片包住「toolbar + children」（如资产列表表格、**安全服务列表**的告警区 + List）。
 */
export function PageFrame(props: {
	title: string;
	description?: ReactNode;
	/** 标题行右侧（如全页刷新、导出）；与表格上方工具条区分。 */
	extra?: ReactNode;
	/**
	 * 说明与主内容之间的操作区（主按钮、次要按钮、链接按钮等），与资产列表页工具条一致。
	 * 不传 `contentCard` 时：单独一行 `Space`，与下方 `children` 间距 16px。
	 */
	toolbar?: ReactNode;
	/** 为 true 时用 `Card` 包住 `toolbar` 与 `children`（与资产列表「卡内按钮 + 表格」一致）。 */
	contentCard?: boolean;
	/** 仅 `contentCard` 时传给 `Card`（如 loading、title）。 */
	cardProps?: Pick<CardProps, 'loading' | 'title' | 'styles' | 'className'>;
	children: ReactNode;
}) {
	const headerGap = props.description != null ? 8 : 12;

	const toolbarRow =
		props.toolbar != null ? (
			<Space style={{ marginBottom: 16 }} wrap>
				{props.toolbar}
			</Space>
		) : null;

	const main = (
		<>
			{toolbarRow}
			{props.children}
		</>
	);

	return (
		<div style={{ paddingBottom: 24 }}>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 16,
					flexWrap: 'wrap',
					marginBottom: headerGap,
				}}
			>
				<Typography.Title level={4} style={{ margin: 0, flex: '1 1 auto' }}>
					{props.title}
				</Typography.Title>
				{props.extra != null ? <div style={{ flexShrink: 0 }}>{props.extra}</div> : null}
			</div>
			{props.description != null ? (
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					{props.description}
				</Typography.Paragraph>
			) : null}
			{props.contentCard ? <Card {...props.cardProps}>{main}</Card> : main}
		</div>
	);
}
