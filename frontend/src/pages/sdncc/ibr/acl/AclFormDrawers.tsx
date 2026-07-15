import React from 'react';
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select } from 'antd';
import type { FormInstance } from 'antd';
import type { ACLGroup, ACLGroupBinding } from './useAclManagement';

const { Option } = Select;

type DrawerShellProps = {
	title: string;
	width?: number;
	open: boolean;
	onClose: () => void;
	onOk: () => void;
	okText?: string;
	confirmLoading?: boolean;
	children: React.ReactNode;
};

function AclDrawerShell({
	title,
	width = 520,
	open,
	onClose,
	onOk,
	okText = '提交',
	confirmLoading,
	children,
}: DrawerShellProps) {
	return (
		<Drawer
			title={<span style={{ fontWeight: 400 }}>{title}</span>}
			width={width}
			open={open}
			onClose={onClose}
			destroyOnClose
			maskClosable={false}
			styles={{ footer: { height: 60, padding: '0 16px', background: '#fff', display: 'flex', alignItems: 'center' } }}
			footer={
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, width: '100%' }}>
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" onClick={onOk} loading={confirmLoading}>
						{okText}
					</Button>
				</div>
			}
		>
			{children}
		</Drawer>
	);
}

type Props = {
	vrList: any[];
	vrNameMap: Record<string, string>;
	groups: ACLGroup[];
	scopedVr?: string;
	groupDrawerOpen: boolean;
	setGroupDrawerOpen: (open: boolean) => void;
	groupForm: FormInstance;
	submitting: boolean;
	onCreateGroup: () => void;
	ruleDrawerOpen: boolean;
	setRuleDrawerOpen: (open: boolean) => void;
	createRuleForm: FormInstance;
	targetGroup: ACLGroup | null;
	onCreateRule: () => void;
	bindDrawerOpen: boolean;
	setBindDrawerOpen: (open: boolean) => void;
	currentBindingGroup: ACLGroup | null;
	bindForm: FormInstance;
	bindingSubmitting: boolean;
	onSubmitBind: () => void;
};

export const AclFormDrawers: React.FC<Props> = ({
	vrList,
	vrNameMap,
	groups,
	scopedVr,
	groupDrawerOpen,
	setGroupDrawerOpen,
	groupForm,
	submitting,
	onCreateGroup,
	ruleDrawerOpen,
	setRuleDrawerOpen,
	createRuleForm,
	targetGroup,
	onCreateRule,
	bindDrawerOpen,
	setBindDrawerOpen,
	currentBindingGroup,
	bindForm,
	bindingSubmitting,
	onSubmitBind,
}) => {
	return (
		<>
			<AclDrawerShell
				title="新建 ACL 组"
				width={500}
				open={groupDrawerOpen}
				onClose={() => setGroupDrawerOpen(false)}
				onOk={onCreateGroup}
				okText={submitting ? '提交中...' : '提交'}
				confirmLoading={submitting}
			>
				<Form form={groupForm} layout="vertical">
					<Form.Item name="name" label="组名称" rules={[{ required: true }]}>
						<Input placeholder="输入 ACL 组名称" />
					</Form.Item>
					<Form.Item name="vrId" label="所属 IBR" rules={[{ required: true }]}>
						<Select placeholder="选择 IBR 实例" disabled={Boolean(scopedVr)}>
							{vrList.map((v) => {
								const id = v.uuid || v.id || v.vm_id;
								const name = v.name || id;
								return id ? (
									<Option key={id} value={id}>
										{name}
									</Option>
								) : null;
							})}
						</Select>
					</Form.Item>
					<Form.Item
						name="aclId"
						label="ACL ID"
						rules={[
							{
								required: true,
								type: 'number',
								min: 1001,
								max: 4000,
								message: '请输入 1001-4000 之间的数字',
							},
						]}
					>
						<InputNumber placeholder="1001-4000" style={{ width: '100%' }} min={1001} max={4000} />
					</Form.Item>
					<Form.Item name="description" label="描述">
						<Input.TextArea rows={3} />
					</Form.Item>
				</Form>
			</AclDrawerShell>

			<AclDrawerShell
				title={targetGroup ? `新建规则 (所属组: ${targetGroup.name})` : '新建 ACL 规则'}
				width={600}
				open={ruleDrawerOpen}
				onClose={() => setRuleDrawerOpen(false)}
				onOk={onCreateRule}
				okText={submitting ? '提交中...' : '提交'}
				confirmLoading={submitting}
			>
				<Form form={createRuleForm} layout="vertical">
					{!targetGroup ? (
						<Row gutter={16}>
							<Col span={24}>
								<Form.Item
									name="groupId"
									label="所属 ACL 组"
									rules={[{ required: true, message: '请选择所属 ACL 组' }]}
								>
									<Select
										placeholder="选择 ACL 组"
										showSearch
										optionFilterProp="label"
										options={(groups || []).map((g) => ({
											value: g.id,
											label: `${g.name}${g.vrId ? `（${vrNameMap[g.vrId] || g.vrId}）` : ''}`,
											vrId: g.vrId,
										}))}
										onChange={(_, opt) => {
											const vrId = (opt as { vrId?: string })?.vrId;
											if (vrId) createRuleForm.setFieldsValue({ vrId });
										}}
									/>
								</Form.Item>
							</Col>
						</Row>
					) : null}
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
								<Input placeholder="输入规则名称" />
							</Form.Item>
						</Col>
						<Col span={12}>
							<Form.Item name="vrId" label="所属 IBR" rules={[{ required: true }]}>
								<Select
									placeholder="选择 IBR 实例"
									disabled={Boolean(targetGroup || scopedVr)}
								>
									{vrList.map((v) => {
										const id = v.uuid || v.id || v.vm_id;
										const name = v.name || id;
										return id ? (
											<Option key={id} value={id}>
												{name}
											</Option>
										) : null;
									})}
								</Select>
							</Form.Item>
						</Col>
					</Row>
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item
								name="priority"
								label="优先级 (1-10000)"
								initialValue={100}
								rules={[{ required: true }]}
							>
								<InputNumber min={1} max={10000} style={{ width: '100%' }} />
							</Form.Item>
						</Col>
						<Col span={12}>
							<Form.Item name="action" label="动作" initialValue="permit" rules={[{ required: true }]}>
								<Select>
									<Option value="permit">Permit (允许)</Option>
									<Option value="deny">Deny (拒绝)</Option>
								</Select>
							</Form.Item>
						</Col>
					</Row>
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item name="protocol" label="协议" initialValue="any" rules={[{ required: true }]}>
								<Select>
									<Option value="any">Any</Option>
									<Option value="tcp">TCP</Option>
									<Option value="udp">UDP</Option>
									<Option value="icmp">ICMP</Option>
								</Select>
							</Form.Item>
						</Col>
					</Row>
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item name="sourceIp" label="源 IP/CIDR" initialValue="any" rules={[{ required: true }]}>
								<Input placeholder="e.g. 192.168.1.0/24 or any" />
							</Form.Item>
						</Col>
						<Col span={12}>
							<Form.Item
								name="destinationIp"
								label="目的 IP/CIDR"
								initialValue="any"
								rules={[{ required: true }]}
							>
								<Input placeholder="e.g. 10.0.0.1 or any" />
							</Form.Item>
						</Col>
					</Row>
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item name="sourcePort" label="源端口" initialValue="any" rules={[{ required: true }]}>
								<Input placeholder="e.g. 80 or 1000-2000 or any" />
							</Form.Item>
						</Col>
						<Col span={12}>
							<Form.Item
								name="destinationPort"
								label="目的端口"
								initialValue="any"
								rules={[{ required: true }]}
							>
								<Input placeholder="e.g. 80 or 443 or any" />
							</Form.Item>
						</Col>
					</Row>
					<Form.Item name="description" label="描述">
						<Input.TextArea rows={3} />
					</Form.Item>
				</Form>
			</AclDrawerShell>

			<AclDrawerShell
				title={`关联 ACL 组: ${currentBindingGroup?.name ?? ''}`}
				width={500}
				open={bindDrawerOpen}
				onClose={() => setBindDrawerOpen(false)}
				onOk={onSubmitBind}
				okText={bindingSubmitting ? '提交中...' : '提交'}
				confirmLoading={bindingSubmitting}
			>
				<Form form={bindForm} layout="vertical">
					<Form.Item name="vrId" label="选择 IBR" rules={[{ required: true }]}>
						<Select placeholder="选择 IBR 实例">
							{vrList
								.filter((v) => {
									const vid = v.uuid || v.id || v.vm_id;
									if (currentBindingGroup?.vrId === vid) return false;
									if (
										currentBindingGroup?.bindings?.some(
											(b: ACLGroupBinding) => b.vrId === vid,
										)
									) {
										return false;
									}
									return true;
								})
								.map((v) => {
									const id = v.uuid || v.id || v.vm_id;
									const name = v.name || id;
									return id ? (
										<Option key={id} value={id}>
											{name}
										</Option>
									) : null;
								})}
						</Select>
					</Form.Item>
				</Form>
			</AclDrawerShell>
		</>
	);
};
