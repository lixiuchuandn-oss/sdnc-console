import type { ReactNode } from 'react';

export type NavItem = {
	key: string;
	label: string;
	icon?: ReactNode;
};

export type NavSection = {
	key: string;
	/** 分组小标题，用来区分互不依赖的操作线 */
	title?: string;
	items: NavItem[];
};
