import type { ReactNode } from 'react';

export type NavItem = {
	key: string;
	label: string;
	icon?: ReactNode;
};

export type NavSection = {
	key: string;
	items: NavItem[];
};
