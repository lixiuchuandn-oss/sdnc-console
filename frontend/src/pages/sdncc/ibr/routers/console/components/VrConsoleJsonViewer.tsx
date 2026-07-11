import React, { useCallback, useMemo } from 'react';
import { Button, message, Spin, Tooltip } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

type Props = {
	loading?: boolean;
	text: string;
};

function isPlainTextHint(text: string): boolean {
	const t = text.trim();
	return (
		t.startsWith('暂无') ||
		t.startsWith('加载') ||
		t.startsWith('Tower') ||
		t.startsWith('正在从')
	);
}

/** 深色控制台 JSON 行号查看器（含复制与行数统计） */
export const VrConsoleJsonViewer: React.FC<Props> = ({ loading, text }) => {
	const lines = useMemo(() => text.split('\n'), [text]);
	const lineCount = lines.length;
	const showEmptyState = !loading && isPlainTextHint(text) && lineCount <= 4;

	const copyAll = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(text);
			message.success('已复制 JSON');
		} catch {
			message.error('复制失败');
		}
	}, [text]);

	if (loading) {
		return (
			<div className="ibr-console-json-loading">
				<Spin tip="加载中…" />
			</div>
		);
	}

	return (
		<div className="ibr-console-json-viewport">
			<div className="ibr-console-json-toolbar">
				<span className="ibr-console-json-meta">
					{lineCount} 行 · {text.length.toLocaleString()} 字符
				</span>
				<Tooltip title="复制全部内容">
					<Button
						type="text"
						size="small"
						className="ibr-console-json-copy"
						icon={<CopyOutlined />}
						onClick={() => void copyAll()}
						disabled={!text.trim()}
					>
						复制
					</Button>
				</Tooltip>
			</div>
			<div className="ibr-console-json-scroll">
				{showEmptyState ? (
					<div className="ibr-console-json-empty">{text}</div>
				) : (
					<div className="ibr-console-json-rows">
						<div aria-hidden className="ibr-console-json-linewrap">
							{lines.map((_, i) => (
								<div key={i} className="ibr-console-json-linenum">
									{i + 1}
								</div>
							))}
						</div>
						<div className="ibr-console-json-codecol">
							{lines.map((line, i) => (
								<div key={i} className="ibr-console-json-codeline">
									{line.length === 0 ? '\u00a0' : line}
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
