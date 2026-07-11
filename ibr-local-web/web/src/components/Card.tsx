import type { ReactNode } from 'react';

type CardProps = {
	children: ReactNode;
	/** 卡片底栏（类似 Ant Design Card 底部分隔区，比 actions 更灵活） */
	footer?: ReactNode;
	className?: string;
	/** table：贴边表格；padded：带内边距；list：List 行式（无卡片内边距） */
	variant?: 'table' | 'padded' | 'list';
};

export function Card(props: CardProps) {
	const variant = props.variant ?? 'padded';
	const hasFooter = props.footer != null;
	const cls = [
		'app-card',
		variant === 'table' ? 'app-card-table' : variant === 'list' ? 'app-card-list' : 'app-card-padded',
		hasFooter ? 'app-card-has-footer' : '',
		props.className,
	]
		.filter(Boolean)
		.join(' ');
	return (
		<div className={cls}>
			{hasFooter ? <div className="app-card-body">{props.children}</div> : props.children}
			{hasFooter ? <div className="app-card-footer">{props.footer}</div> : null}
		</div>
	);
}
