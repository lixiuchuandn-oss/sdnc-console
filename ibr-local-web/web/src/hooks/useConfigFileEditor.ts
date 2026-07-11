import { useCallback, useRef, useState } from 'react';

type UseConfigFileEditorOptions = {
	load: () => Promise<string>;
	save: (content: string) => Promise<void>;
	onSaved?: () => void | Promise<void>;
};

export function useConfigFileEditor(options: UseConfigFileEditorOptions) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [content, setContent] = useState('');
	const [draft, setDraft] = useState('');

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await optionsRef.current.load();
			setContent(next);
			setEditing((currentEditing) => {
				if (!currentEditing) setDraft(next);
				return currentEditing;
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	const openDrawer = useCallback(() => {
		setOpen(true);
		setEditing(false);
		setError(null);
		void reload();
	}, [reload]);

	const closeDrawer = useCallback(() => {
		setOpen(false);
		setEditing(false);
		setError(null);
	}, []);

	const startEdit = useCallback(() => {
		setEditing(true);
		setDraft(content);
		setError(null);
	}, [content]);

	const cancelEdit = useCallback(() => {
		setEditing(false);
		setDraft(content);
		setError(null);
	}, [content]);

	const save = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			await optionsRef.current.save(draft);
			setEditing(false);
			await reload();
			await optionsRef.current.onSaved?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : '保存失败');
		} finally {
			setLoading(false);
		}
	}, [draft, reload]);

	return {
		open,
		openDrawer,
		closeDrawer,
		loading,
		editing,
		error,
		content,
		draft,
		setDraft,
		reload,
		startEdit,
		cancelEdit,
		save,
	};
}
