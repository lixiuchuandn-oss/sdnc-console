import React from 'react';
import { Button, Typography } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import { openIbrLocalWeb } from '../../../lib/ibrLocalWebUrl';

type Props = {
	message?: string;
	managementIp?: string;
};

export const VrConsoleNoDevicePanel: React.FC<Props> = ({
	message = '该 IBR 尚未上报管理口 IP，无法经 SDNC 代理访问设备 local-web。',
	managementIp,
}) => (
	<div className="ibr-console-placeholder">
		<CloudServerOutlined className="ibr-console-placeholder-icon" />
		<Typography.Title level={5} className="ibr-console-placeholder-title">
			设备未就绪
		</Typography.Title>
		<Typography.Paragraph className="ibr-console-placeholder-desc">{message}</Typography.Paragraph>
		<ul className="ibr-console-placeholder-steps">
			<li>确认设备侧 local-web 已启动并完成管理口上报</li>
			<li>在 IBR 列表查看「管理 IP」列是否已显示</li>
			<li>或直接打开设备本机 Console 完成配置</li>
		</ul>
		{managementIp ? (
			<Button type="primary" onClick={() => openIbrLocalWeb({ management_ip: managementIp })}>
				打开本机 Console
			</Button>
		) : null}
	</div>
);
