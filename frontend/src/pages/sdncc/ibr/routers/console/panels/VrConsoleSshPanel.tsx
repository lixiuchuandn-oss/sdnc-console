import React, { useMemo, useState } from 'react';
import { Button, Form, Input, Typography } from 'antd';
import WebSshTerminal, { type WebSshConnectParams } from 'components/WebSshTerminal';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	managementIp: string;
	vrName?: string;
};

type SshFormValues = {
	username: string;
	password: string;
};

export const VrConsoleSshPanel: React.FC<Props> = ({ managementIp, vrName }) => {
	const canConnect = useIbrConsoleWritePermission('networks.vr-config:write');

	const host = useMemo(() => managementIp.split('/')[0]!.trim(), [managementIp]);
	const [connect, setConnect] = useState<WebSshConnectParams | null>(null);
	const [form] = Form.useForm<SshFormValues>();

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	const handleConnect = () => {
		void form.validateFields().then(({ username, password }) => {
			setConnect({
				host,
				port: 22,
				username: username.trim(),
				password,
				bootstrap: 'linux',
			});
		});
	};

	const sshTitle = connect ? `ssh ${connect.username}@${connect.host}` : `ssh root@${host}`;

	if (connect) {
		return (
			<div className="ibr-console-ops-panel ibr-console-ops-panel--fill ibr-console-ops-panel--ssh-terminal">
				<WebSshTerminal
					active
					fillParent
					connect={connect}
					title={sshTitle}
					onChangeCredentials={() => setConnect(null)}
				/>
			</div>
		);
	}

	return (
		<div className="ibr-console-ops-panel">
			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">SSH 连接</Typography.Text>
				</div>
				<div className="ibr-console-ops-card">
					{vrName && vrName !== '—' ? (
						<div className="ibr-console-info-row">
							<span className="ibr-console-info-label">设备名称</span>
							<span>{vrName}</span>
						</div>
					) : null}
					<div className="ibr-console-info-row">
						<span className="ibr-console-info-label">管理 IP</span>
						<Typography.Text copyable={{ text: host }}>{host}</Typography.Text>
					</div>

					{canConnect ? (
						<Form
							form={form}
							layout="vertical"
							initialValues={{ username: 'root' }}
							className="ibr-console-ops-ssh-form"
							onFinish={handleConnect}
						>
							<Form.Item
								label="用户名"
								name="username"
								rules={[{ required: true, message: '请输入用户名' }]}
							>
								<Input
									className="ibr-console-ops-input"
									autoComplete="off"
									placeholder="root"
								/>
							</Form.Item>
							<Form.Item
								label="密码"
								name="password"
								rules={[{ required: true, message: '请输入设备 SSH 密码' }]}
							>
								<Input.Password
									className="ibr-console-ops-input"
									autoComplete="new-password"
									placeholder="设备 root 密码"
									onPressEnter={handleConnect}
								/>
							</Form.Item>
							<div className="ibr-console-ops-actions">
								<Button type="primary" htmlType="submit">
									连接 SSH
								</Button>
							</div>
						</Form>
					) : (
						<Typography.Paragraph type="secondary" className="ibr-console-ops-empty">
							当前账号缺少 IBR 写权限（networks.vr-config:write），无法发起 WebSSH。
						</Typography.Paragraph>
					)}
				</div>
			</div>
		</div>
	);
};
