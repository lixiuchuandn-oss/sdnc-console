import React, { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, Drawer, Modal, Table } from 'antd';
import type { DrawerProps, ModalProps } from 'antd';
import type { TableProps } from 'antd';

export const FORWARD_TABLE_PAGE_SIZE = 10;

/** 深色控制台表格：表体透明、数据行 hover 用 rowHoverBg */
const IBR_CONSOLE_FORWARD_TABLE_THEME = {
	components: {
		Table: {
			colorBgContainer: 'transparent',
			headerBg: 'transparent',
			rowHoverBg: '#0d1117',
			colorFillAlter: '#0d1117',
			borderColor: 'transparent',
		},
	},
};

/** 深色控制台表格空状态（纯文案，不用 antd Empty 浅色插图） */
export function forwardTableEmpty(text: string) {
	return <div className="ibr-console-table-empty-text">{text}</div>;
}

/** 对齐 ibr-local-web DataTable：空表去掉 scroll.x，避免横向滚动条 */
export function ConsoleForwardTable<T extends object>(props: TableProps<T>) {
	const { scroll, dataSource, locale, className, ...rest } = props;
	const rowCount = Array.isArray(dataSource) ? dataSource.length : 0;

	const resolvedScroll = useMemo(() => {
		if (!scroll || rowCount > 0 || scroll.x == null) return scroll;
		const { x: _x, ...restScroll } = scroll as { x?: unknown };
		return Object.keys(restScroll).length > 0 ? restScroll : undefined;
	}, [scroll, rowCount]);

	return (
		<ConfigProvider theme={IBR_CONSOLE_FORWARD_TABLE_THEME}>
			<Table<T>
				{...rest}
				dataSource={dataSource}
				scroll={resolvedScroll}
				locale={locale}
				bordered={false}
				size="middle"
				pagination={false}
				className={['ibr-console-data-table', className].filter(Boolean).join(' ')}
			/>
		</ConfigProvider>
	);
}

export function useForwardTablePage<T>(rows: T[], pageSize = FORWARD_TABLE_PAGE_SIZE) {
	const [page, setPage] = useState(1);
	const total = rows.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
	const currentPage = Math.min(page, totalPages);

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	const pageData = useMemo(() => {
		if (total <= pageSize) return rows;
		const start = (currentPage - 1) * pageSize;
		return rows.slice(start, start + pageSize);
	}, [rows, currentPage, pageSize, total]);

	return { page: currentPage, setPage, pageData, total, pageSize, totalPages };
}

export function ForwardTableFooter(props: {
	total: number;
	page: number;
	pageSize: number;
	onChange: (page: number) => void;
}) {
	if (props.total <= 0) return null;
	const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
	const start = (props.page - 1) * props.pageSize + 1;
	const end = Math.min(props.page * props.pageSize, props.total);

	return (
		<div className="ibr-console-table-footer">
			<span className="ibr-console-table-range">
				Showing {start}-{end} of {props.total}
			</span>
			<div className="ibr-console-table-pager">
				<button
					type="button"
					className="ibr-console-table-pager-btn"
					disabled={props.page <= 1}
					onClick={() => props.onChange(props.page - 1)}
				>
					Prev
				</button>
				<span className="ibr-console-table-pager-info">
					{props.page} / {totalPages}
				</span>
				<button
					type="button"
					className="ibr-console-table-pager-btn"
					disabled={props.page >= totalPages}
					onClick={() => props.onChange(props.page + 1)}
				>
					Next
				</button>
			</div>
		</div>
	);
}

type ForwardTextDrawerProps = {
	title: string;
	open: boolean;
	onClose: () => void;
	text: string;
	emptyText?: string;
	zIndex?: number;
};

/** VR 控制台统一深色 Drawer */
export function ConsoleOpsDrawer({ rootClassName, ...props }: DrawerProps) {
	return (
		<Drawer
			{...props}
			rootClassName={['ibr-console-drawer', rootClassName].filter(Boolean).join(' ')}
		/>
	);
}

export function ForwardTextDrawer({
	title,
	open,
	onClose,
	text,
	emptyText = '—',
	zIndex,
}: ForwardTextDrawerProps) {
	return (
		<ConsoleOpsDrawer title={title} width={720} open={open} onClose={onClose} zIndex={zIndex}>
			<pre className="ibr-console-ops-pre ibr-console-ops-pre--scroll ibr-console-ops-pre--drawer">
				{text.trim() ? text : emptyText}
			</pre>
		</ConsoleOpsDrawer>
	);
}

/** VR 控制台统一深色 Modal（portal 到 body，须 rootClassName + 全局 CSS） */
export function ConsoleOpsModal({ rootClassName, className, ...props }: ModalProps) {
	return (
		<Modal
			{...props}
			rootClassName={['ibr-console-ops-modal-root', rootClassName].filter(Boolean).join(' ')}
			className={['ibr-console-ops-modal', className].filter(Boolean).join(' ')}
		/>
	);
}
