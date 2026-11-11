import React, { useState } from 'react';
import { AutoComplete, Col, Form, Input, InputNumber, Radio, Row, Select, Tabs, message } from 'antd';
import type { FormListFieldData, FormListOperation } from 'antd/es/form';
import {
	createDefaultGroup,
	createDefaultInstance,
	nextGroupId,
	nextInstanceVrid,
	type HaDeviceIface,
	type HaVrrpGroupForm,
	type HaVrrpInstanceForm,
} from './haGroupWizardLib';

const sectionHeader = (text: string) => (
	<div
		style={{
			color: '#1677ff',
			margin: '4px 0 12px 0',
			borderBottom: '1px solid #e8e8e8',
			paddingBottom: 6,
		}}
	>
		{text}
	</div>
);

type HaGroupNodeVrrpPaneProps = {
	role: 'primary' | 'backup';
	ifaces: HaDeviceIface[];
	ifaceLoading?: boolean;
	defaultPriority: number;
};

function planTabEdit(
	fields: FormListFieldData[],
	targetKey: string,
	activeKey: string,
): { removeIndex: number; nextActiveKey: string } | null {
	const idx = fields.findIndex((field) => String(field.name) === String(targetKey));
	if (idx < 0) return null;
	const remain = fields.filter((_, i) => i !== idx);
	const next =
		String(activeKey) === String(targetKey)
			? String(remain[Math.max(0, idx - 1)]?.name ?? remain[0]?.name ?? 0)
			: activeKey;
	return { removeIndex: idx, nextActiveKey: next };
}

const HaGroupNodeVrrpPane: React.FC<HaGroupNodeVrrpPaneProps> = ({
	role,
	ifaces,
	ifaceLoading,
	defaultPriority,
}) => {
	const form = Form.useFormInstance();
	const [activeInstKey, setActiveInstKey] = useState('0');
	const [activeGroupKey, setActiveGroupKey] = useState('0');

	const ifaceOptions = ifaces.map((item) => ({
		value: item.name,
		label: item.ipv4 ? `${item.name} · ${item.ipv4}` : item.name,
	}));

	const renderInstance = (field: FormListFieldData) => (
		<div>
			<Row gutter={16}>
				<Col span={12}>
					<Form.Item
						{...field}
						name={[field.name, 'interface']}
						label="绑定接口"
						rules={[{ required: true, message: '请选择或输入绑定接口' }]}
					>
						<AutoComplete
							allowClear
							options={ifaceOptions}
							placeholder="例如 GigabitEthernet 0/9/0"
							filterOption={(input, option) =>
								String(option?.value || '')
									.toLowerCase()
									.includes(input.toLowerCase())
							}
							disabled={ifaceLoading && ifaceOptions.length === 0}
						/>
					</Form.Item>
				</Col>
				<Col span={6}>
					<Form.Item
						{...field}
						name={[field.name, 'vrid']}
						label="VRRP ID"
						rules={[{ required: true, message: '请输入 VRRP ID' }]}
					>
						<InputNumber min={1} max={255} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
				<Col span={6}>
					<Form.Item
						{...field}
						name={[field.name, 'priority']}
						label="优先级"
						rules={[{ required: true, message: '请输入优先级' }]}
					>
						<InputNumber min={1} max={255} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
			</Row>
			<Row gutter={16}>
				<Col span={12}>
					<Form.Item
						{...field}
						name={[field.name, 'virtualIp']}
						label="VRRP IP"
						rules={[{ required: true, message: '请输入 VRRP IP' }]}
					>
						<Input placeholder="例如 10.16.160.123/26" />
					</Form.Item>
				</Col>
				<Col span={12}>
					<Form.Item {...field} name={[field.name, 'authPass']} label="认证密码（可选）">
						<Input.Password placeholder="可留空" autoComplete="new-password" />
					</Form.Item>
				</Col>
			</Row>
			<Row gutter={16}>
				<Col span={8}>
					<Form.Item
						{...field}
						name={[field.name, 'preempt']}
						label="抢占"
						extra="设备默认抢占"
					>
						<Radio.Group
							optionType="button"
							buttonStyle="solid"
							options={[
								{ label: '抢占', value: true },
								{ label: '不抢占', value: false },
							]}
						/>
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						{...field}
						name={[field.name, 'advertInterval']}
						label="通告间隔（秒）"
						extra="默认 1 秒，范围 1–256"
					>
						<InputNumber min={1} max={256} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						{...field}
						name={[field.name, 'advertMode']}
						label="通告方式"
						rules={[{ required: true }]}
						extra="默认组播，设备侧不写单播命令"
					>
						<Radio.Group
							optionType="button"
							buttonStyle="solid"
							options={[
								{ label: '组播', value: 'multicast' },
								{ label: '单播', value: 'unicast' },
							]}
						/>
					</Form.Item>
				</Col>
			</Row>
			<Form.Item
				noStyle
				shouldUpdate={(prev, cur) =>
					prev?.[role]?.instances?.[field.name]?.advertMode !==
					cur?.[role]?.instances?.[field.name]?.advertMode
				}
			>
				{() => {
					const mode = form.getFieldValue([role, 'instances', field.name, 'advertMode']);
					if (mode !== 'unicast') return null;
					return (
						<Row gutter={16}>
							<Col span={12}>
								<Form.Item
									{...field}
									name={[field.name, 'unicastSource']}
									label="单播源 IP"
									rules={[{ required: true, message: '请填写单播源 IP' }]}
									extra="默认取本接口 IPv4，可改"
								>
									<Input placeholder="例如 10.16.160.124" />
								</Form.Item>
							</Col>
							<Col span={12}>
								<Form.Item
									{...field}
									name={[field.name, 'unicastPeer']}
									label="单播对端地址"
									rules={[{ required: true, message: '请填写单播对端地址' }]}
									extra="默认取对端同序号实例接口 IPv4，可改"
								>
									<Input placeholder="例如 10.16.160.125" />
								</Form.Item>
							</Col>
						</Row>
					);
				}}
			</Form.Item>
		</div>
	);

	const renderGroup = (field: FormListFieldData) => (
		<div>
			<Row gutter={16}>
				<Col span={8}>
					<Form.Item
						{...field}
						name={[field.name, 'groupId']}
						label="Group ID"
						rules={[{ required: true, message: '请输入 Group ID' }]}
					>
						<InputNumber min={1} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item noStyle shouldUpdate>
						{() => {
							const instances: HaVrrpInstanceForm[] =
								form.getFieldValue([role, 'instances']) || [];
							const options = instances.map((inst, idx) => ({
								value: Number(inst?.vrid) || idx + 1,
								label: `实例 ${idx + 1} · VRID ${inst?.vrid ?? '—'}`,
							}));
							return (
								<Form.Item
									{...field}
									name={[field.name, 'vrrpInstanceId']}
									label="VRRP 实例 ID"
									rules={[{ required: true, message: '请选择 VRRP 实例 ID' }]}
								>
									<Select options={options} placeholder="选择本节点已配实例" />
								</Form.Item>
							);
						}}
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						{...field}
						name={[field.name, 'trackInterval']}
						label="探测间隔（秒）"
						extra="默认 1 秒"
					>
						<InputNumber min={1} max={255} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
			</Row>
			<Form.Item
				{...field}
				name={[field.name, 'trackGateway']}
				label="Track 网关（可选）"
				extra="网关或任意可达地址；IPv4 不带掩码，也可填接口名"
			>
				<Input placeholder="例如 172.16.23.3" />
			</Form.Item>
		</div>
	);

	const onInstanceEdit = (fields: FormListFieldData[], ops: FormListOperation) => {
		return (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
			if (action === 'add') {
				const current: HaVrrpInstanceForm[] = form.getFieldValue([role, 'instances']) || [];
				const vrid = nextInstanceVrid(current);
				ops.add(createDefaultInstance(defaultPriority, vrid));
				setActiveInstKey(String(fields.length));
				return;
			}
			if (fields.length <= 1) {
				message.warning('至少保留 1 条 VRRP 实例');
				return;
			}
			const plan = planTabEdit(fields, String(targetKey), activeInstKey);
			if (!plan) return;
			ops.remove(plan.removeIndex);
			setActiveInstKey(plan.nextActiveKey);
		};
	};

	const onGroupEdit = (fields: FormListFieldData[], ops: FormListOperation) => {
		return (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
			if (action === 'add') {
				const current: HaVrrpGroupForm[] = form.getFieldValue([role, 'groups']) || [];
				const instances: HaVrrpInstanceForm[] = form.getFieldValue([role, 'instances']) || [];
				const groupId = nextGroupId(current);
				const vrrpInstanceId = Number(instances[0]?.vrid) || 1;
				ops.add(createDefaultGroup(groupId, vrrpInstanceId));
				setActiveGroupKey(String(fields.length));
				return;
			}
			if (fields.length <= 1) {
				message.warning('至少保留 1 条 VRRP 组策略');
				return;
			}
			const plan = planTabEdit(fields, String(targetKey), activeGroupKey);
			if (!plan) return;
			ops.remove(plan.removeIndex);
			setActiveGroupKey(plan.nextActiveKey);
		};
	};

	return (
		<>
			{sectionHeader('VRRP 实例')}
			<div style={{ color: 'rgba(0,0,0,.45)', marginBottom: 8, fontSize: 12 }}>
				实例绑定在接口上。可添加多组，每组单独填写 VRRP ID / VIP / 优先级。
			</div>
			<Form.List name={[role, 'instances']}>
				{(fields, ops) => (
					<Tabs
						type="editable-card"
						size="small"
						tabBarGutter={8}
						activeKey={activeInstKey}
						onChange={setActiveInstKey}
						onEdit={onInstanceEdit(fields, ops)}
						items={fields.map((field, idx) => ({
							key: String(field.name),
							label: `实例 ${idx + 1}`,
							closable: fields.length > 1,
							children: renderInstance(field),
						}))}
					/>
				)}
			</Form.List>
			<div style={{ height: 16 }} />
			{sectionHeader('VRRP 组策略')}
			<div style={{ color: 'rgba(0,0,0,.45)', marginBottom: 8, fontSize: 12 }}>
				全局 vrrp group：关联上面的实例 ID；Track 网关可选。
			</div>
			<Form.List name={[role, 'groups']}>
				{(fields, ops) => (
					<Tabs
						type="editable-card"
						size="small"
						tabBarGutter={8}
						activeKey={activeGroupKey}
						onChange={setActiveGroupKey}
						onEdit={onGroupEdit(fields, ops)}
						items={fields.map((field, idx) => ({
							key: String(field.name),
							label: `策略 ${idx + 1}`,
							closable: fields.length > 1,
							children: renderGroup(field),
						}))}
					/>
				)}
			</Form.List>
		</>
	);
};

export default HaGroupNodeVrrpPane;
