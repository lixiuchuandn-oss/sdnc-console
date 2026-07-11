import { message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { isAuthRequiredError } from '../../api/apiError';
import { api } from '../../api/client';
import type { GatewayInfo } from './saseTypes';

export function useSaseGatewayInfo() {
	const [loading, setLoading] = useState(true);
	const [info, setInfo] = useState<GatewayInfo | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<GatewayInfo>('/sase/gateways/info');
			setInfo(data);
		} catch (e) {
			if (isAuthRequiredError(e)) {
				setInfo({ needsLogin: true });
			} else {
				setInfo({ unavailable: true });
			}
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const openSso = useCallback(async (serviceId: string | number) => {
		try {
			const { data } = await api.post<{ url: string }>(
				`/sase/services/${encodeURIComponent(String(serviceId))}/sso`,
				{},
			);
			const url = data.url;
			if (!url) {
				message.warning('暂时无法打开控制台，请稍后重试');
				return;
			}
			window.open(url, '_blank', 'noopener,noreferrer');
		} catch (e) {
			if (isAuthRequiredError(e)) {
				message.warning('请先登录后再进入控制台');
			} else {
				message.warning('暂时无法打开控制台，请稍后重试');
			}
		}
	}, []);

	return { loading, info, load, openSso };
}
