import { Spin } from 'antd';
import type { TableProps } from 'antd';
import type { ReactNode } from 'react';
import { BlockHeader } from './BlockHeader';
import { Card } from './Card';
import { ContentBlock } from './ContentBlock';
import { DataTable, TableFooter, useDataTablePage } from './DataTable';

type TableBlockProps<T extends object> = Omit<TableProps<T>, 'pagination' | 'bordered' | 'size' | 'dataSource'> & {
	title: string;
	action?: ReactNode;
	loading?: boolean;
	dataSource: T[];
	paginated?: boolean;
	pageSize?: number;
};

export function TableBlock<T extends object>(props: TableBlockProps<T>) {
	const { title, action, loading, dataSource, paginated = true, pageSize = 10, ...tableProps } = props;
	const rows = dataSource ?? [];
	const pageState = useDataTablePage(rows, pageSize);
	const tableData = paginated ? pageState.pageData : rows;

	return (
		<ContentBlock>
			<BlockHeader title={title} action={action} />
			<Card variant="table">
				<Spin spinning={loading}>
					<DataTable<T> showPagination={false} {...tableProps} dataSource={tableData} />
				</Spin>
			</Card>
			{paginated ? (
				<TableFooter total={pageState.total} page={pageState.page} pageSize={pageSize} onChange={pageState.setPage} />
			) : null}
		</ContentBlock>
	);
}
