import type { ReactNode } from 'react';

export function ContentBlock(props: { children: ReactNode; className?: string }) {
	const cls = ['app-block', props.className].filter(Boolean).join(' ');
	return <div className={cls}>{props.children}</div>;
}
