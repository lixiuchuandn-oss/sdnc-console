import React from 'react';

type TabItem<T extends string> = {
	id: T;
	label: string;
};

type Props<T extends string> = {
	tabs: TabItem<T>[];
	activeTab: T;
	onChange: (tab: T) => void;
	ariaLabel: string;
	/** 多 Tab 时允许换行（设备信息等） */
	wrap?: boolean;
};

export function IbrConsoleSegmented<T extends string>({
	tabs,
	activeTab,
	onChange,
	ariaLabel,
	wrap = false,
}: Props<T>) {
	return (
		<div className={`ibr-console-panel-tabs${wrap ? ' ibr-console-panel-tabs--wrap' : ''}`}>
			<div className="ibr-console-segmented" role="tablist" aria-label={ariaLabel}>
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={activeTab === tab.id}
						className={`ibr-console-segmented-btn${activeTab === tab.id ? ' is-active' : ''}`}
						onClick={() => onChange(tab.id)}
					>
						{tab.label}
					</button>
				))}
			</div>
		</div>
	);
}
