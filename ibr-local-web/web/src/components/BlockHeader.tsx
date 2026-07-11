import type { ReactNode } from 'react';

export function BlockHeader(props: { title: string; description?: string; action?: ReactNode }) {
	return (
		<div className="app-block-header">
			<div className="app-block-heading">
				<h2 className="app-block-title">{props.title}</h2>
				{props.description ? <p className="app-block-description">{props.description}</p> : null}
			</div>
			{props.action != null ? <div className="app-block-action">{props.action}</div> : null}
		</div>
	);
}
