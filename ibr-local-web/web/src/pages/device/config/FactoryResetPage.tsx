import { Alert, App as AntApp, Button, Input, Modal, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

const CONFIRM_PHRASE = 'FACTORY_RESET';

type Caps = {
	factory_reset?: boolean;
	factory_reset_confirm?: string;
};

export function FactoryResetPage() {
	const navigate = useNavigate();
	const [confirmText, setConfirmText] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [phrase, setPhrase] = useState(CONFIRM_PHRASE);
	const { message } = AntApp.useApp();

	useEffect(() => {
		void api
			.get<Caps & { ok?: boolean }>('/nics/capabilities')
			.then(({ data }) => {
				if (typeof data?.factory_reset_confirm === 'string' && data.factory_reset_confirm.trim()) {
					setPhrase(data.factory_reset_confirm.trim());
				}
			})
			.catch(() => undefined);
	}, []);

	const matched = confirmText.trim() === phrase;

	return (
		<>
			<PageStack>
				<PageHeader
					title="恢复出厂设置"
					description="建议新机、旧机在接入前都先做一次，让本机回到干净初始状态后再注册。"
				/>

				<ContentBlock>
					<BlockHeader title="说明" />
					<Card variant="padded">
						<Alert
							type="error"
							showIcon
							message="设备将恢复到初始状态，本地配置全部清空"
							description="业务网卡接管、口地址、路由策略等本地配置都会清掉；设备身份（含 UUID）会清空并重新生成，再次注册时控制器会将其视为新设备。"
						/>
					</Card>
				</ContentBlock>

				<ContentBlock>
					<BlockHeader title="确认执行" />
					<Card variant="padded">
						<Typography.Paragraph>
							请输入确认口令 <Typography.Text code>{phrase}</Typography.Text> 后继续：
						</Typography.Paragraph>
						<Input
							value={confirmText}
							onChange={(e) => setConfirmText(e.target.value)}
							placeholder={phrase}
							autoComplete="off"
							disabled={saving}
						/>
						{error ? (
							<Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
								{error}
							</Typography.Paragraph>
						) : null}
						<Space style={{ marginTop: 16 }}>
							<Button
								danger
								type="primary"
								disabled={!matched}
								loading={saving}
								onClick={() => {
									Modal.confirm({
										title: '确认恢复出厂设置？',
										content: '本机将清空本地业务配置。设备身份（含 UUID）会重新生成，再次注册时按新设备接入。',
										okText: '确认出厂',
										okType: 'danger',
										cancelText: '取消',
										onOk: async () => {
											setSaving(true);
											setError(null);
											try {
												const { data } = await api.post<{
													ok: boolean;
													logs?: string[];
													error?: string;
													degraded?: boolean;
													rebind_failed?: string[];
												}>('/nics/factory_reset', {
													confirm: phrase,
													return_to_os: true,
												});
												if (!data?.ok) throw new Error(data?.error || '出厂恢复失败');
												setConfirmText('');
												const failed = Array.isArray(data.rebind_failed)
													? data.rebind_failed.map(String).filter(Boolean)
													: [];
												if (failed.length > 0) {
													message.warning(`出厂已执行，但以下口退回系统网卡未完全成功：${failed.join(', ')}`);
													navigate('/init');
													return;
												}
												if (data.degraded) {
													message.warning('出厂已完成，数据面暂未就绪；请稍后再初始化网卡。');
													navigate('/init');
													return;
												}
												message.success('已恢复出厂设置');
												navigate('/init');
											} catch (e) {
												setError(e instanceof Error ? e.message : '出厂恢复失败');
											} finally {
												setSaving(false);
											}
										},
									});
								}}
							>
								执行恢复出厂
							</Button>
						</Space>
					</Card>
				</ContentBlock>
			</PageStack>
		</>
	);
}
