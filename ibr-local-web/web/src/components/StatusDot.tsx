export function StatusDot(props: { active?: boolean; label: string }) {
	return (
		<span className="app-status-dot">
			<span className={`app-status-dot-mark${props.active !== false ? ' app-status-dot-mark-on' : ''}`} aria-hidden />
			<span>{props.label}</span>
		</span>
	);
}
