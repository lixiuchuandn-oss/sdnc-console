import type { ReactNode } from 'react';

export function Section(props: {
	title: string;
	action?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const cls = ['app-section', props.className].filter(Boolean).join(' ');
	return (
		<section className={cls}>
			<div className="app-section-head">
				<h2 className="app-section-title">{props.title}</h2>
				{props.action != null ? <div className="app-section-action">{props.action}</div> : null}
			</div>
			<div className="app-section-body">{props.children}</div>
			{props.footer != null ? <div className="app-section-foot">{props.footer}</div> : null}
		</section>
	);
}
