import type { ReactNode } from 'react';

export function PageHeader(props: { title: string; description?: ReactNode }) {
	return (
		<header className="app-page-header">
			<h1 className="app-page-title">{props.title}</h1>
			{props.description != null ? <p className="app-page-desc">{props.description}</p> : null}
		</header>
	);
}
