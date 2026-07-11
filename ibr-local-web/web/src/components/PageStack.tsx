import type { ReactNode } from 'react';

/** 页面内容纵向栈：PageHeader、ContentBlock 等业务块之间用统一 gap 间隔 */
export function PageStack(props: { children: ReactNode; className?: string }) {
	const cls = ['app-page-stack', props.className].filter(Boolean).join(' ');
	return <div className={cls}>{props.children}</div>;
}
