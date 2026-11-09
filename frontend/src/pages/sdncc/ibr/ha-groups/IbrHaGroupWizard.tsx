import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Alert,
	Button,
	Card,
	Col,
	Descriptions,
	Divider,
	Form,
	Input,
	InputNumber,
	Row,
	Select,
	Space,
	Steps,
	Switch,
	Tag,
	Typography,
	message,
} from 'antd';
import { CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../../services/api';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
	createIbrHaGroup,
	deployIbrHaGroup,
	fetchIbrHaGroup,
	updateIbrHaGroup,
	type IbrHaGroup,
} from '../../../../services/ibrHaGroupApi';
import {
	applyIbrVrRolesToRows,
	buildIbrVrRolesMapFromVr2,
	ibrVrRowId,
	ibrVrRowName,
	loadIbrVrCatalog,
} from '../lib/ibrVrCatalog';
import IbrWizardCard, { ibrWizardStepCardTitle } from '../lib/IbrWizardCard';
import IbrWizardPage from '../lib/IbrWizardPage';
import IbrWizardStepPane from '../lib/IbrWizardStepPane';
import {
	HA_GROUP_MEMBER_SCOPE_HINT,
	HA_GROUP_WIZARD_DEFAULTS,
	HA_PLACEMENT_OPTIONS,
	buildHaGroupVrrpIntent,
	generateHaGroupName,
	haGroupEligibleRoleLabel,
	isHaGroupEligibleIbrRole,
	parseVrrpIntentToForm,
	placementLabel,
	validateHaGroupWizardForm,
	type HaGroupWizardFormValues,
} from './haGroupWizardLib';
import {
	handleWizardStepsChange,
	validateWizardStepsThrough,
	warnFormValidationFailure,
} from '../routers/vrWizardFormUtils';

const { Text } = Typography;

const STEP_TITLES = ['基础信息', '主备成员', 'VRRP 策略', '确认并保存', '策略下发'] as const;

type HaGroupVrOption = {
	label: string;
	value: string;
	role: string;
	managementIp?: string | null;
};

function memberByRole(group: IbrHaGroup | null, role: 'primary' | 'backup') {
	return group?.members?.find((m) => m.role === role);
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

const IbrHaGroupWizard: React.FC = () => {
	const navigate = useNavigate();
	const { user } = useAuth();
	const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
	const canWrite =
		user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.vr-config:write');
	const { id: editId } = useParams<{ id?: string }>();
	const isEdit = Boolean(editId?.trim());

	useEffect(() => {
		if (!canWrite) {
			message.warning('无 IBR 配置写权限，无法创建或编辑高可用组');
			navigate('/admin/interconnect/ha-groups', { replace: true });
		}
	}, [canWrite, navigate]);

	const [form] = Form.useForm<HaGroupWizardFormValues>();
	const [current, setCurrent] = useState(0);
	const [loading, setLoading] = useState(false);
	const [vrLoading, setVrLoading] = useState(false);
	const [vrOptions, setVrOptions] = useState<HaGroupVrOption[]>([]);
	const [vrMgmtMap, setVrMgmtMap] = useState<Record<string, string>>({});
	const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
	const [vrRoleMap, setVrRoleMap] = useState<Record<string, string>>({});
	const [savedGroup, setSavedGroup] = useState<IbrHaGroup | null>(null);
	const [platformSaved, setPlatformSaved] = useState(false);
	const [deployLoading, setDeployLoading] = useState(false);
	const [deployDone, setDeployDone] = useState(false);
	const [deployError, setDeployError] = useState<string | null>(null);
	const [previewKey, setPreviewKey] = useState(0);

	const primaryUuid = Form.useWatch('primaryUuid', form);
	const backupUuid = Form.useWatch('backupUuid', form);

	const catalogLoadGenRef = useRef(0);
	const editLoadGenRef = useRef(0);

	const loadVrCatalog = useCallback(async () => {
		const gen = ++catalogLoadGenRef.current;
		setVrLoading(true);
		try {
			const catalog = await loadIbrVrCatalog({ force: true });
			if (gen !== catalogLoadGenRef.current) return;
			const roleMap = await buildIbrVrRolesMapFromVr2(catalog.vrs, { skipCache: true });
			if (gen !== catalogLoadGenRef.current) return;
			const enrichedVrs = applyIbrVrRolesToRows(catalog.vrs, roleMap);

			setVrNameMap(catalog.nameMap);
			setVrRoleMap(roleMap);
			const mgmtMap: Record<string, string> = {};
			enrichedVrs.forEach((vr) => {
				const uuid = ibrVrRowId(vr);
				const ip = String((vr as { management_ip?: string; managementIp?: string }).management_ip
					?? (vr as { managementIp?: string }).managementIp ?? '').trim();
				if (uuid && ip) mgmtMap[uuid] = ip;
			});
			setVrMgmtMap(mgmtMap);
			setVrOptions(
				enrichedVrs.flatMap((vr): HaGroupVrOption[] => {
					const uuid = ibrVrRowId(vr);
					const role = roleMap[uuid] || '';
					if (!uuid || !isHaGroupEligibleIbrRole(role)) return [];
					const mgmt = mgmtMap[uuid];
					return [
						{
							value: uuid,
							role,
							managementIp: mgmt ?? null,
							label: `${catalog.nameMap[uuid] || ibrVrRowName(vr) || uuid} [${haGroupEligibleRoleLabel(role)}]${mgmt ? ` · ${mgmt}` : ''}`,
						},
					];
				}),
			);
		} catch (e) {
			if (gen !== catalogLoadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载 IBR 实例目录失败'));
		} finally {
			if (gen === catalogLoadGenRef.current) setVrLoading(false);
		}
	}, []);

	const loadExistingGroup = useCallback(async () => {
		if (!editId?.trim()) return;
		const gen = ++editLoadGenRef.current;
		const reqId = editId.trim();
		setLoading(true);
		try {
			const group = await fetchIbrHaGroup(reqId);
			if (gen !== editLoadGenRef.current || reqId !== editId?.trim()) return;
			setSavedGroup(group);
			setPlatformSaved(true);
			setDeployDone(group.status === 'configured');
			setDeployError(null);
			const primary = memberByRole(group, 'primary');
			const backup = memberByRole(group, 'backup');
			const vrrpForm = parseVrrpIntentToForm(group.vrrpIntent, {
				primaryUuid: primary?.vrUuid || '',
				backupUuid: backup?.vrUuid || '',
			});
			form.setFieldsValue({
				name: group.name,
				description: group.description || undefined,
				primaryUuid: primary?.vrUuid,
				backupUuid: backup?.vrUuid,
				...HA_GROUP_WIZARD_DEFAULTS,
				...vrrpForm,
			});
		} catch (e) {
			if (gen !== editLoadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载 HA 组失败'));
			navigate('/admin/interconnect/ha-groups');
		} finally {
			if (gen === editLoadGenRef.current) setLoading(false);
		}
	}, [editId, form, navigate]);

	useEffect(() => {
		void loadVrCatalog();
		if (isEdit) {
			void loadExistingGroup();
		} else {
			form.setFieldsValue({
				...HA_GROUP_WIZARD_DEFAULTS,
				name: generateHaGroupName('access'),
			});
		}
	}, [form, isEdit, loadExistingGroup, loadVrCatalog]);

	const previewIntent = useMemo(() => {
		void previewKey;
		try {
			const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
			if (!values.primaryUuid || !values.backupUuid) return null;
			return buildHaGroupVrrpIntent(values);
		} catch {
			return null;
		}
	}, [form, previewKey]);

	const refreshPreview = () => setPreviewKey((k) => k + 1);

	const placement = Form.useWatch('placement', form);

	const haFieldsForStep = (step: number): string[] => {
		if (step === 0) return ['name', 'description', 'placement'];
		if (step === 1) return ['primaryUuid', 'backupUuid'];
		if (step === 2) {
			return [
				'vrid',
				'virtualIp',
				'advertInterval',
				'primaryPriority',
				'backupPriority',
				'primaryInterface',
				'backupInterface',
				'primaryTrackGateway',
				'backupTrackGateway',
				'primaryInterfaceIp',
				'backupInterfaceIp',
			];
		}
		return [];
	};

	const validateHaStepsThrough = (from: number, to: number) =>
		validateWizardStepsThrough(form, from, to, haFieldsForStep);

	const next = async () => {
		try {
			const ok = await validateHaStepsThrough(current, current + 1);
			if (!ok) return;
			if (current === 2) {
				const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
				const formErr = validateHaGroupWizardForm(values);
				if (formErr) {
					message.error(formErr);
					return;
				}
			}
			setCurrent((c) => Math.min(c + 1, STEP_TITLES.length - 1));
			refreshPreview();
		} catch (err) {
			warnFormValidationFailure(err);
		}
	};

	const prev = () => setCurrent((c) => Math.max(c - 1, 0));

	const handleSaveToPlatform = async () => {
		try {
			const values = await form.validateFields();
			const formErr = validateHaGroupWizardForm(values);
			if (formErr) {
				message.error(formErr);
				return;
			}
			setLoading(true);
			const vrrpIntent = buildHaGroupVrrpIntent(values);
			if (isEdit && editId) {
				const updated = await updateIbrHaGroup(editId, {
					name: values.name,
					description: values.description || null,
					vrrpIntent,
				});
				setSavedGroup(updated);
			} else {
				const created = await createIbrHaGroup({
					name: values.name,
					description: values.description,
					primaryUuid: values.primaryUuid,
					backupUuid: values.backupUuid,
					vrrpIntent,
				});
				setSavedGroup(created);
				navigate(`/admin/interconnect/ha-groups/${created.id}/wizard`, { replace: true });
			}
			setPlatformSaved(true);
			setDeployDone(false);
			setDeployError(null);
			message.success(isEdit ? 'HA 组已更新' : 'HA 组已创建（草稿）');
			refreshPreview();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '保存失败'));
		} finally {
			setLoading(false);
		}
	};

	const handleDeploy = async () => {
		const groupId = String(savedGroup?.id || editId || '').trim();
		if (!groupId) {
			message.error('请先保存 HA 组到平台');
			return;
		}
		if (!platformSaved && !savedGroup) {
			message.error('请先保存 HA 组到平台');
			return;
		}
		setDeployLoading(true);
		setDeployError(null);
		try {
			const result = await deployIbrHaGroup(groupId);
			setSavedGroup(result.group);
			setDeployDone(true);
			message.success('主备 VRRP 已下发到设备');
		} catch (e) {
			const msg = getApiErrorMessage(e, '下发失败');
			setDeployError(msg);
			message.error(msg);
			try {
				const refreshed = await fetchIbrHaGroup(groupId);
				setSavedGroup(refreshed);
			} catch {
				/* ignore refresh errors */
			}
		} finally {
			setDeployLoading(false);
		}
	};

	const vrLabel = (uuid?: string) => {
		const id = String(uuid || '').trim();
		if (!id) return '—';
		const role = vrRoleMap[id];
		const roleSuffix = role ? ` [${haGroupEligibleRoleLabel(role)}]` : '';
		const mgmt = vrMgmtMap[id];
		return `${vrNameMap[id] || id}${roleSuffix}${mgmt ? ` · ${mgmt}` : ''}`;
	};

	const placementHint =
		HA_PLACEMENT_OPTIONS.find((o) => o.value === placement)?.hint ?? HA_PLACEMENT_OPTIONS[0]!.hint;

	const eligibleVrCount = vrOptions.length;

	const renderStep0 = () => (
		<>
			<Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message="双机主备编组仅面向 CE / 标准模式 IBR"
				description={HA_GROUP_MEMBER_SCOPE_HINT}
			/>
			<Form.Item
				name="name"
				label="组名称"
				rules={[{ required: true, message: '请输入组名称' }]}
			>
				<Input placeholder="例如 ha-acc-k3m9x2p7q1w" maxLength={128} />
			</Form.Item>
			<Form.Item name="description" label="备注">
				<Input.TextArea rows={3} maxLength={500} placeholder="可选：站点、用途、维护窗口等" />
			</Form.Item>
			<Form.Item
				name="placement"
				label="部署侧（Placement）"
				rules={[{ required: true, message: '请选择部署侧' }]}
				extra={placementHint}
			>
				<Select options={HA_PLACEMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
			</Form.Item>
			<Descriptions size="small" column={1} bordered>
				<Descriptions.Item label="高可用模式">双机主备（active-standby）</Descriptions.Item>
				<Descriptions.Item label="成员数量">2 台 IBR（1 主 + 1 备）</Descriptions.Item>
				<Descriptions.Item label="中间选路">PE 侧 SRv6 segment list（不由本组 VRRP 联动）</Descriptions.Item>
			</Descriptions>
		</>
	);

	const renderStep1 = () => (
		<>
			<Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message="仅列出 VR2 实时配置中 role 为 CE 或标准模式的 IBR"
				description={`${HA_GROUP_MEMBER_SCOPE_HINT} 角色从 CSMCTL VR2/VRConfig 回读，与 IBR Console「VR2 实时配置」一致。`}
			/>
			{eligibleVrCount < 2 ? (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					message="可选实例不足"
					description="至少需要 2 台 CE 或标准模式 IBR。请确认 CSMCTL 可达且 VR2 配置中已写入 role 字段；PE 实例无需加入 HA 组。"
				/>
			) : null}
			<Row gutter={16}>
				<Col span={12}>
					<Form.Item
						name="primaryUuid"
						label="主节点（Primary）"
						rules={[{ required: true, message: '请选择主节点' }]}
					>
						<Select
							showSearch
							loading={vrLoading}
							optionFilterProp="label"
							placeholder="选择 primary"
							options={vrOptions}
						/>
					</Form.Item>
				</Col>
				<Col span={12}>
					<Form.Item
						name="backupUuid"
						label="备节点（Backup）"
						rules={[
							{ required: true, message: '请选择备节点' },
							({ getFieldValue }) => ({
								validator(_rule, value) {
									if (!value || value !== getFieldValue('primaryUuid')) {
										return Promise.resolve();
									}
									return Promise.reject(new Error('备节点不能与主节点相同'));
								},
							}),
						]}
					>
						<Select
							showSearch
							loading={vrLoading}
							optionFilterProp="label"
							placeholder="选择 backup"
							options={vrOptions}
						/>
					</Form.Item>
				</Col>
			</Row>
			<Card size="small" type="inner" title="成员预览">
				<Descriptions size="small" column={1}>
					<Descriptions.Item label="主节点">{vrLabel(primaryUuid)}</Descriptions.Item>
					<Descriptions.Item label="备节点">{vrLabel(backupUuid)}</Descriptions.Item>
					<Descriptions.Item label="可选实例数">
						{eligibleVrCount} 台（CE / 标准）
					</Descriptions.Item>
				</Descriptions>
			</Card>
		</>
	);

	const renderStep2 = () => (
		<>
			<Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message="VRRP 参数（方案二）"
				description="主备须分别配置 track-gateway，指向各自主/备路径上的上游 PE 接口或网关 IPv4。中间 PE 故障时由 SRv6 路由重选 segment list，不依赖四台 VRRP 整链联动。"
			/>
			<Row gutter={16}>
				<Col span={8}>
					<Form.Item
						name="vrid"
						label="VRID"
						rules={[{ required: true, message: '请输入 VRID' }]}
					>
						<InputNumber min={1} max={255} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						name="virtualIp"
						label="虚拟 IP（VIP）"
						rules={[{ required: true, message: '请输入虚拟 IP' }]}
					>
						<Input placeholder="例如 192.168.1.254" />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						name="advertInterval"
						label="通告间隔（秒）"
						rules={[{ required: true, message: '请输入通告间隔' }]}
					>
						<InputNumber min={1} max={60} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
			</Row>
			<Row gutter={16}>
				<Col span={12}>
					<Form.Item name="trackInterface" label="组级跟踪接口（可选）">
						<Input placeholder="本地额外 track 接口，可留空" />
					</Form.Item>
				</Col>
				<Col span={12}>
					<Form.Item name="authPass" label="认证口令（可选）">
						<Input.Password placeholder="VRRP 认证口令" autoComplete="new-password" />
					</Form.Item>
				</Col>
			</Row>
			<Form.Item name="preempt" label="抢占模式" valuePropName="checked">
				<Switch checkedChildren="开启" unCheckedChildren="关闭" />
			</Form.Item>
			<Divider orientation="left" plain>
				主节点（Primary）
			</Divider>
			<Row gutter={16}>
				<Col span={8}>
					<Form.Item
						name="primaryPriority"
						label="优先级"
						rules={[{ required: true, message: '请输入主节点优先级' }]}
					>
						<InputNumber min={1} max={255} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						name="primaryInterface"
						label="VRRP 绑定接口"
						rules={[{ required: true, message: '请输入主节点 VRRP 接口' }]}
					>
						<Input placeholder="例如 GigabitEthernet2/1/0" />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						name="primaryTrackGateway"
						label="Track-gateway"
						rules={[{ required: true, message: '请输入主路径 track-gateway' }]}
						extra="上游 PE 接口名或 IPv4"
					>
						<Input placeholder="例如 GigabitEthernet2/2/0" />
					</Form.Item>
				</Col>
			</Row>
			<Row gutter={16}>
				<Col span={12}>
					<Form.Item
						name="primaryInterfaceIp"
						label="接口 IP（单播 source）"
						extra="现网 HA：unicast-source；与备节点 IP 成对填写"
					>
						<Input placeholder="例如 10.16.160.124" />
					</Form.Item>
				</Col>
			</Row>
			<Divider orientation="left" plain>
				备节点（Backup）
			</Divider>
			<Row gutter={16}>
				<Col span={8}>
					<Form.Item
						name="backupPriority"
						label="优先级"
						rules={[
							{ required: true, message: '请输入备节点优先级' },
							({ getFieldValue }) => ({
								validator(_rule, value) {
									const primary = Number(getFieldValue('primaryPriority'));
									const backup = Number(value);
									if (!Number.isFinite(primary) || !Number.isFinite(backup) || primary > backup) {
										return Promise.resolve();
									}
									return Promise.reject(new Error('备节点优先级须低于主节点'));
								},
							}),
						]}
					>
						<InputNumber min={1} max={255} style={{ width: '100%' }} />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						name="backupInterface"
						label="VRRP 绑定接口"
						rules={[{ required: true, message: '请输入备节点 VRRP 接口' }]}
					>
						<Input placeholder="例如 GigabitEthernet2/1/0" />
					</Form.Item>
				</Col>
				<Col span={8}>
					<Form.Item
						name="backupTrackGateway"
						label="Track-gateway"
						rules={[{ required: true, message: '请输入备路径 track-gateway' }]}
						extra="备路径上游 PE 接口名或 IPv4"
					>
						<Input placeholder="例如 GigabitEthernet2/3/4" />
					</Form.Item>
				</Col>
			</Row>
			<Row gutter={16}>
				<Col span={12}>
					<Form.Item
						name="backupInterfaceIp"
						label="接口 IP（单播 source）"
						extra="现网 HA：unicast-source；与主节点 IP 成对填写"
					>
						<Input placeholder="例如 10.16.160.125" />
					</Form.Item>
				</Col>
			</Row>
		</>
	);

	const renderStep3 = () => {
		const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
		return (
			<>
				<Alert
					type="info"
					showIcon
					style={{ marginBottom: 16 }}
					message="确认后将保存 HA 组与方案二 vrrpIntent 到平台"
					description="状态为「草稿」；边缘 VRRP（含 track-gateway）待 CSMCTL 下发能力接入后推到主备 IBR，中间 PE 选路由 SRv6 segment list 负责。"
				/>
				<Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
					<Descriptions.Item label="组名称">{values.name || '—'}</Descriptions.Item>
					<Descriptions.Item label="部署侧">{placementLabel(values.placement)}</Descriptions.Item>
					<Descriptions.Item label="备注">{values.description || '—'}</Descriptions.Item>
					<Descriptions.Item label="主节点">{vrLabel(values.primaryUuid)}</Descriptions.Item>
					<Descriptions.Item label="备节点">{vrLabel(values.backupUuid)}</Descriptions.Item>
					<Descriptions.Item label="VRID / VIP">
						{values.vrid} / {values.virtualIp || '—'}
					</Descriptions.Item>
					<Descriptions.Item label="主备优先级">
						{values.primaryPriority} / {values.backupPriority}
					</Descriptions.Item>
					<Descriptions.Item label="Track-gateway">
						主 {values.primaryTrackGateway || '—'} · 备 {values.backupTrackGateway || '—'}
					</Descriptions.Item>
					<Descriptions.Item label="VRRP 单播">
						{values.primaryInterfaceIp && values.backupInterfaceIp
							? `主 ${values.primaryInterfaceIp} ↔ 备 ${values.backupInterfaceIp}`
							: '未配置（组播）'}
					</Descriptions.Item>
					<Descriptions.Item label="抢占模式">
						{values.preempt !== false ? <Tag color="blue">开启</Tag> : <Tag>关闭</Tag>}
					</Descriptions.Item>
					{savedGroup ? (
						<Descriptions.Item label="平台状态">
							<Tag>{savedGroup.status === 'draft' ? '草稿' : savedGroup.status}</Tag>
						</Descriptions.Item>
					) : null}
				</Descriptions>
			</>
		);
	};

	const deploySteps = [
		{
			title: '保存 HA 组与 vrrpIntent 到平台',
			desc: platformSaved || savedGroup ? '已完成' : '待执行',
			done: platformSaved || Boolean(savedGroup),
		},
		{
			title: '下发主 / 备节点 VRRP',
			desc: deployDone
				? '已完成'
				: deployError
					? '失败（见下方说明）'
					: '读设备底稿 → 合并 interface/vrrp → CSMCTL 全量 POST',
			done: deployDone,
		},
		{
			title: '校验 VRRP 与 SRv6 选路',
			desc: '请在 IBR Console VRRP 面板核对主备；中间 PE 仍由 SRv6 segment list 选路',
			done: deployDone,
		},
	];

	const renderStep4 = () => (
		<>
			<Alert
				type={deployDone ? 'success' : 'info'}
				showIcon
				style={{ marginBottom: 16 }}
				message={
					deployDone
						? '策略已下发到主备 IBR'
						: '下发将按设备当前配置定点合并 VRRP，不会整表覆盖其它业务域'
				}
				description="方案二：边缘 CE 双机 VRRP（含 track-gateway）；中间 PE 选路仍由 SRv6 隧道负责。"
			/>
			{deployError ? (
				<Alert
					type="error"
					showIcon
					style={{ marginBottom: 16 }}
					message="下发未完全成功"
					description={
						savedGroup?.status === 'degraded'
							? `${deployError}（组状态已标为 degraded，请排查后备节点后重试）`
							: deployError
					}
				/>
			) : null}
			<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
				{deploySteps.map((step, idx) => (
					<Card
						key={step.title}
						size="small"
						type="inner"
						title={
							<Space>
								<span
									style={{
										display: 'inline-flex',
										width: 24,
										height: 24,
										borderRadius: '50%',
										background: step.done ? '#52c41a' : '#d9d9d9',
										color: '#fff',
										alignItems: 'center',
										justifyContent: 'center',
										fontSize: 12,
									}}
								>
									{idx + 1}
								</span>
								<span>{step.title}</span>
								<Text type="secondary" style={{ fontSize: 12 }}>
									{step.desc}
								</Text>
							</Space>
						}
						extra={
							idx === 1 ? (
								<Button
									type="primary"
									size="small"
									loading={deployLoading}
									disabled={!platformSaved && !savedGroup}
									onClick={() => void handleDeploy()}
								>
									{deployDone ? '重新下发' : '下发主备'}
								</Button>
							) : (
								<Button size="small" disabled>
									{step.done ? '已完成' : '—'}
								</Button>
							)
						}
					/>
				))}
			</div>
			{savedGroup ? (
				<div style={{ marginTop: 12 }}>
					<Text type="secondary" style={{ fontSize: 12 }}>
						平台状态：
						<Tag style={{ marginLeft: 8 }}>
							{savedGroup.status === 'draft'
								? '草稿'
								: savedGroup.status === 'configured'
									? '已配置'
									: savedGroup.status === 'degraded'
										? '降级'
										: savedGroup.status}
						</Tag>
					</Text>
				</div>
			) : null}
		</>
	);

	const renderStepContent = () => {
		switch (current) {
			case 0:
				return renderStep0();
			case 1:
				return renderStep1();
			case 2:
				return renderStep2();
			case 3:
				return renderStep3();
			case 4:
				return renderStep4();
			default:
				return null;
		}
	};

	if (!canWrite) {
		return null;
	}

	return (
		<IbrWizardPage
			title={isEdit ? '配置 IBR 高可用组' : undefined}
			onBack={() => navigate('/admin/interconnect/ha-groups')}
			layout="linear"
			steps={
					<Steps
						direction="vertical"
						size="small"
						current={current}
						onChange={(idx) => {
							if (idx >= 4 && !platformSaved) {
								message.warning('请先在「确认并保存」中完成保存到平台');
								return;
							}
							if (idx >= 4) {
								setCurrent(idx);
								return;
							}
							void handleWizardStepsChange(idx, current, setCurrent, validateHaStepsThrough);
						}}
						items={STEP_TITLES.map((title, idx) => ({
							title,
							disabled: idx === 4 && !platformSaved,
						}))}
					/>
				}
				main={
					<IbrWizardStepPane
						title={ibrWizardStepCardTitle(current, STEP_TITLES[current])}
						footerLeft={
							<>
								{current !== 4 && (
									<Button onClick={() => navigate('/admin/interconnect/ha-groups')}>
										返回列表
									</Button>
								)}
								{current > 0 && current !== 4 && <Button onClick={prev}>上一步</Button>}
								{current === 4 && (
									<Button type="primary" onClick={() => navigate('/admin/interconnect/ha-groups')}>
										关闭向导
									</Button>
								)}
							</>
						}
						footerRight={
							<>
								{current < 3 && (
									<Button type="primary" onClick={() => void next()}>
										下一步
									</Button>
								)}
								{current === 3 && (
									<>
										{platformSaved && (
											<span
												style={{
													color: '#52c41a',
													display: 'inline-flex',
													alignItems: 'center',
													fontWeight: 500,
													marginRight: 8,
												}}
											>
												<CheckCircleOutlined style={{ marginRight: 4 }} />
												已保存到平台
											</span>
										)}
										<Button
											type="primary"
											loading={loading}
											disabled={platformSaved && !isEdit}
											onClick={() => void handleSaveToPlatform()}
										>
											{isEdit ? '更新并保存' : '创建并保存'}
										</Button>
										<Button
											type="primary"
											disabled={!platformSaved}
											onClick={() => setCurrent(4)}
										>
											进入下发向导
										</Button>
									</>
								)}
							</>
						}
					>
						<Form form={form} layout="vertical" preserve>
							{renderStepContent()}
						</Form>
					</IbrWizardStepPane>
				}
				preview={
					<IbrWizardCard
						sticky
						title="VRRP 意图预览"
						extra={
							<Button
								type="text"
								icon={<ReloadOutlined />}
								size="small"
								onClick={refreshPreview}
								title="刷新预览"
							/>
						}
					>
						<Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
							保存时将写入 HA 组的 <code>vrrpIntent</code> 字段
						</Text>
						<pre
							style={{
								fontSize: 12,
								lineHeight: '18px',
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
								overflowX: 'auto',
								margin: 0,
								maxHeight: 520,
							}}
						>
							{previewIntent ? safeStringify(previewIntent) : '请选择主备成员并填写 VRRP 参数'}
						</pre>
					</IbrWizardCard>
				}
		/>
	);
};

export default IbrHaGroupWizard;
