import type { NavSection } from './navTypes.js';

type AppSiderNavProps = {
	sections: NavSection[];
	selectedKey: string;
	onNavigate: (path: string) => void;
};

export function AppSiderNav(props: AppSiderNavProps) {
	return (
		<nav className="app-nav" aria-label="主导航">
			{props.sections.map((section, index) => (
				<div key={section.key} className="app-nav-section">
					{index > 0 ? <div className="app-nav-gap" aria-hidden /> : null}
					{section.items.map((item) => {
						const active = props.selectedKey === item.key;
						return (
							<span key={item.key} className="app-nav-item-wrap">
								<button
									type="button"
									className={`app-nav-item${active ? ' app-nav-item-active' : ''}`}
									onClick={() => props.onNavigate(item.key)}
									aria-current={active ? 'page' : undefined}
								>
									{item.icon != null ? <span className="app-nav-icon">{item.icon}</span> : null}
									<span className="app-nav-label">{item.label}</span>
								</button>
							</span>
						);
					})}
				</div>
			))}
		</nav>
	);
}
