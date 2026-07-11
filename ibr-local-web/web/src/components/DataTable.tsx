import { Table } from 'antd';
import type { TableProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';

type DataTableProps<T extends object> = Omit<TableProps<T>, 'pagination' | 'bordered' | 'size'> & {
	pageSize?: number;
	showPagination?: boolean;
};

export function useDataTablePage<T>(rows: T[], pageSize = 10) {
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

export function TableFooter(props: {
	total: number;
	page: number;
	pageSize: number;
	onChange: (page: number) => void;
	className?: string;
}) {
	if (props.total <= 0) return null;

	const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
	const start = (props.page - 1) * props.pageSize + 1;
	const end = Math.min(props.page * props.pageSize, props.total);
	const cls = ['app-table-footer', props.className].filter(Boolean).join(' ');

	return (
		<div className={cls}>
			<span className="app-table-range">
				Showing {start}-{end} of {props.total}
			</span>
			<div className="app-table-pager">
				<button
					type="button"
					className="app-table-pager-btn"
					disabled={props.page <= 1}
					onClick={() => props.onChange(props.page - 1)}
				>
					Prev
				</button>
				<span className="app-table-pager-info">
					{props.page} / {totalPages}
				</span>
				<button
					type="button"
					className="app-table-pager-btn"
					disabled={props.page >= totalPages}
					onClick={() => props.onChange(props.page + 1)}
				>
					Next
				</button>
			</div>
		</div>
	);
}

export function DataTable<T extends object>(props: DataTableProps<T>) {
	const { pageSize = 10, showPagination = true, dataSource, scroll, ...rest } = props;
	const { page, setPage, pageData, total } = useDataTablePage(dataSource ?? [], pageSize);

	const rows = showPagination ? pageData : (dataSource ?? []);
	const resolvedScroll = useMemo(() => {
		if (!scroll || rows.length > 0 || scroll.x == null) return scroll;
		const { x: _x, ...restScroll } = scroll;
		return Object.keys(restScroll).length > 0 ? restScroll : undefined;
	}, [scroll, rows.length]);

	return (
		<div className="app-data-table-wrap">
			<Table<T>
				{...rest}
				scroll={resolvedScroll}
				dataSource={rows}
				bordered={false}
				size="middle"
				pagination={false}
				className={['app-data-table', rest.className].filter(Boolean).join(' ')}
			/>
			{showPagination ? (
				<TableFooter total={total} page={page} pageSize={pageSize} onChange={setPage} />
			) : null}
		</div>
	);
}
