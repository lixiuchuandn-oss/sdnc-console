import React from 'react';
import type { SystemFooterPresentation } from '../lib/systemFooterSummary';

type Props = {
	presentation: SystemFooterPresentation | null;
};

/** IBR 运维控制台 · 页面级底栏（系统信息） */
export const VrConsoleSystemFooter: React.FC<Props> = ({ presentation }) => {
	if (!presentation) return null;

	return (
		<footer className="ibr-console-system-footer" aria-label="系统信息">
			<span className="ibr-console-system-footer-title">系统信息</span>
			<div className="ibr-console-system-footer-scroll">
				{presentation.items.map((item) => (
					<span key={item.label} className="ibr-console-system-footer-item">
						<span className="ibr-console-system-footer-item__label">{item.label}</span>
						<span className="ibr-console-system-footer-item__value">{item.value}</span>
					</span>
				))}
			</div>
			<span className="ibr-console-system-footer-source">{presentation.source}</span>
		</footer>
	);
};
