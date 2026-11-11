import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Alert,
	Button,
	Card,
	Col,
	Descriptions,
	Form,
	Input,
	Radio,
	Row,
	Select,
	Space,
	Steps,
	Tabs,
	Tag,
	Typography,
	message,
} from 'antd';
import type { FormInstance } from 'antd/es/form';
import { CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../../services/api';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
	createIbrHaGroup,
	deployIbrHaGroup,
	fetchIbrHaGroup,
	replaceIbrHaGroupMembers,
	updateIbrHaGroup,
	type IbrHaGroup,
} from '../../../../services/ibrHaGroupApi';
import { fetchVrCacheMerged } from '../../../../services/virtualRouterApi';
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
import HaGroupNodeVrrpPane from './HaGroupNodeVrrpPane';
import {
	HA_GROUP_MEMBER_SCOPE_HINT,
	HA_GROUP_WIZARD_DEFAULTS,
	HA_SIDE_OPTIONS,
	buildHaGroupVrrpIntent,
	collectHaDeviceIfaces,
	createDefaultNodeVrrp,
	generateHaGroupName,
	haGroupEligibleRoleLabel,
	isAutoHaGroupName,
	isHaGroupEligibleIbrRole,
	lookupIfaceIpv4,
	matchPeerInstance,
	parseVrrpIntentToForm,
	sideLabel,
	validateHaGroupWizardForm,
	type HaDeviceIface,
	type HaGroupSide,
	type HaGroupWizardFormValues,
	type HaVrrpInstanceForm,
} from './haGroupWizardLib';
import {
	handleWizardStepsChange,
	validateWizardStepsThrough,
	warnFormValidationFailure,
} from '../routers/vrWizardFormUtils';

const { Text } = Typography;

const STEP_TITLES = ['基础信息', '节点业务配置', '确认并保存', '策略下发'] as const;

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

function fillUnicastDefaults(
	form: FormInstance<HaGroupWizardFormValues>,
	all: HaGroupWizardFormValues,
	ifaceMap: Record<string, HaDeviceIface[]>,
	forceIndexes?: { role: 'primary' | 'backup'; index: number }[],
) {
	const roles: Array<'primary' | 'backup'> = ['primary', 'backup'];
	for (const role of roles) {
		const peerRole = role === 'primary' ? 'backup' : 'primary';
		const uuid = role === 'primary' ? all.primaryUuid : all.backupUuid;
		const peerUuid = peerRole === 'primary' ? all.primaryUuid : all.backupUuid;
		const instances = all[role]?.instances || [];
		const peerInstances = all[peerRole]?.instances || [];
		instances.forEach((inst, idx) => {
			if (inst?.advertMode !== 'unicast') return;
			const force = forceIndexes?.some((item) => item.role === role && item.index === idx);
			const thisIp = lookupIfaceIpv4(ifaceMap[uuid], String(inst.interface || ''));
			const peerInst = matchPeerInstance(peerInstances, idx, Number(inst.vrid));
			const peerIp = lookupIfaceIpv4(ifaceMap[peerUuid], String(peerInst?.interface || ''));
			if (thisIp && (force || !String(inst.unicastSource || '').trim())) {
				form.setFieldValue([role, 'instances', idx, 'unicastSource'], thisIp);
			}
			if (peerIp && (force || !String(inst.unicastPeer || '').trim())) {
				form.setFieldValue([role, 'instances', idx, 'unicastPeer'], peerIp);
			}
		});
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
	const [deviceTab, setDeviceTab] = useState<'primary' | 'backup'>('primary');
	const [ifaceMap, setIfaceMap] = useState<Record<string, HaDeviceIface[]>>({});
	const [ifaceLoadingMap, setIfaceLoadingMap] = useState<Record<string, boolean>>({});

	const primaryUuid = Form.useWatch('primaryUuid', form);
	const backupUuid = Form.useWatch('backupUuid', form);
	const side = Form.useWatch('side', form) as HaGroupSide | undefined;

	const catalogLoadGenRef = useRef(0);
	const editLoadGenRef = useRef(0);
	const ifaceLoadGenRef = useRef<Record<string, number>>({});

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
				const ip = String(
					(vr as { management_ip?: string; managementIp?: string }).management_ip ??
						(vr as { managementIp?: string }).managementIp ??
						'',
				).trim();
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

	const loadDeviceIfaces = useCallback(async (uuid: string) => {
		const id = String(uuid || '').trim();
		if (!id) return;
		const gen = (ifaceLoadGenRef.current[id] || 0) + 1;
		ifaceLoadGenRef.current[id] = gen;
		setIfaceLoadingMap((prev) => ({ ...prev, [id]: true }));
		try {
			const merged = await fetchVrCacheMerged(id);
			if (ifaceLoadGenRef.current[id] !== gen) return;
			setIfaceMap((prev) => ({ ...prev, [id]: collectHaDeviceIfaces(merged) }));
		} catch {
			if (ifaceLoadGenRef.current[id] !== gen) return;
			setIfaceMap((prev) => ({ ...prev, [id]: prev[id] || [] }));
		} finally {
			if (ifaceLoadGenRef.current[id] === gen) {
				setIfaceLoadingMap((prev) => ({ ...prev, [id]: false }));
			}
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
				...HA_GROUP_WIZARD_DEFAULTS,
				name: group.name,
				description: group.description || undefined,
				primaryUuid: primary?.vrUuid,
				backupUuid: backup?.vrUuid,
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
				name: generateHaGroupName('local'),
				primary: createDefaultNodeVrrp('primary'),
				backup: createDefaultNodeVrrp('backup'),
			});
		}
	}, [form, isEdit, loadExistingGroup, loadVrCatalog]);

	useEffect(() => {
		if (primaryUuid) void loadDeviceIfaces(primaryUuid);
		if (backupUuid) void loadDeviceIfaces(backupUuid);
	}, [backupUuid, loadDeviceIfaces, primaryUuid]);

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

	const haFieldsForStep = (step: number): string[] => {
		if (step === 0) return ['name', 'side', 'primaryUuid', 'backupUuid'];
		return [];
	};

	const validateHaStepsThrough = (from: number, to: number) =>
		validateWizardStepsThrough(form, from, to, haFieldsForStep, {
			beforeAdvance: async (step) => {
				if (step !== 1) return true;
				try {
					await form.validateFields();
				} catch (err) {
					warnFormValidationFailure(err);
					return false;
				}
				const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
				const formErr = validateHaGroupWizardForm(values);
				if (formErr) {
					message.error(formErr);
					return false;
				}
				return true;
			},
		});

	const next = async () => {
		try {
			const ok = await validateHaStepsThrough(current, current + 1);
			if (!ok) return;
			setCurrent((c) => Math.min(c + 1, STEP_TITLES.length - 1));
			refreshPreview();
		} catch (err) {
			warnFormValidationFailure(err);
		}
	};

	const prev = () => setCurrent((c) => Math.max(c - 1, 0));

	const handleSaveToPlatform = async () => {
		try {
			await form.validateFields();
			const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
			const formErr = validateHaGroupWizardForm(values);
			if (formErr) {
				message.error(formErr);
				return;
			}
			setLoading(true);
			const vrrpIntent = buildHaGroupVrrpIntent(values);
			if (isEdit && editId) {
				const currentPrimary = memberByRole(savedGroup, 'primary')?.vrUuid;
				const currentBackup = memberByRole(savedGroup, 'backup')?.vrUuid;
				if (
					currentPrimary &&
					currentBackup &&
					(currentPrimary !== values.primaryUuid || currentBackup !== values.backupUuid)
				) {
					await replaceIbrHaGroupMembers(editId, {
						primaryUuid: values.primaryUuid,
						backupUuid: values.backupUuid,
					});
				}
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

	const deviceTabLabel = (role: 'primary' | 'backup') => {
		const uuid = String((role === 'primary' ? primaryUuid : backupUuid) || '').trim();
		const fallback = role === 'primary' ? '主节点' : '备节点';
		const name = (uuid && (vrNameMap[uuid] || uuid)) || fallback;
		return `${name}（${role === 'primary' ? '主' : '备'}）`;
	};

	const sideHint = HA_SIDE_OPTIONS.find((o) => o.value === side)?.hint ?? HA_SIDE_OPTIONS[0]!.hint;
	const eligibleVrCount = vrOptions.length;

	const onFormValuesChange = (
		changed: Partial<HaGroupWizardFormValues>,
		all: HaGroupWizardFormValues,
	) => {
		if (changed.side && isAutoHaGroupName(all.name)) {
			form.setFieldValue('name', generateHaGroupName(changed.side));
		}
		const forceIndexes: { role: 'primary' | 'backup'; index: number }[] = [];
		(['primary', 'backup'] as const).forEach((role) => {
			const instances = (changed[role] as { instances?: HaVrrpInstanceForm[] } | undefined)?.instances;
			if (!Array.isArray(instances)) return;
			instances.forEach((inst, idx) => {
				if (!inst || typeof inst !== 'object') return;
				if (inst.interface !== undefined || inst.advertMode !== undefined) {
					forceIndexes.push({ role, index: idx });
				}
			});
		});
		fillUnicastDefaults(form, all, ifaceMap, forceIndexes.length ? forceIndexes : undefined);
		refreshPreview();
	};

	const renderStep0 = () => (
		<>
			<Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message="一次向导配置一组主备"
				description={HA_GROUP_MEMBER_SCOPE_HINT}
			/>
			<Form.Item name="name" label="组名称" rules={[{ required: true, message: '请输入组名称' }]}>
				<Input placeholder="例如 ha-loc-k3m9x2p7q1w" maxLength={128} />
			</Form.Item>
			<Form.Item name="description" label="备注">
				<Input.TextArea rows={2} maxLength={500} placeholder="可选：站点、用途、维护窗口等" />
			</Form.Item>
			<Form.Item
				name="side"
				label="HA 组角色"
				rules={[{ required: true, message: '请选择本端或对端' }]}
				extra={sideHint}
			>
				<Radio.Group
					optionType="button"
					buttonStyle="solid"
					options={HA_SIDE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
				/>
			</Form.Item>
			{eligibleVrCount < 2 ? (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					message="可选实例不足"
					description="至少需要 2 台 CE 或标准模式 IBR。请确认 CSMCTL 可达且 VR2 配置中已写入 role 字段。"
				/>
			) : null}
			<Row gutter={16}>
				<Col xs={24} md={12}>
					<Form.Item
						name="primaryUuid"
						label="主节点"
						rules={[{ required: true, message: '请选择主节点' }]}
					>
						<Select
							showSearch
							loading={vrLoading}
							optionFilterProp="label"
							placeholder="选择主节点设备"
							options={vrOptions.filter((opt) => opt.value !== backupUuid)}
						/>
					</Form.Item>
				</Col>
				<Col xs={24} md={12}>
					<Form.Item
						name="backupUuid"
						label="备节点"
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
							placeholder="选择备节点设备"
							options={vrOptions.filter((opt) => opt.value !== primaryUuid)}
						/>
					</Form.Item>
				</Col>
			</Row>
		</>
	);

	const renderStep1 = () => (
		<>
			<Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message="按节点分别配置 VRRP"
				description="每个标签对应一台设备。先配接口上的 VRRP 实例，再配全局组策略。主备两台都需要配置。"
			/>
			<Tabs
				type="card"
				activeKey={deviceTab}
				onChange={(key) => setDeviceTab(key as 'primary' | 'backup')}
				items={[
					{
						key: 'primary',
						label: deviceTabLabel('primary'),
						disabled: !primaryUuid,
						forceRender: true,
						children: (
							<HaGroupNodeVrrpPane
								role="primary"
								ifaces={ifaceMap[String(primaryUuid || '')] || []}
								ifaceLoading={ifaceLoadingMap[String(primaryUuid || '')]}
								defaultPriority={200}
							/>
						),
					},
					{
						key: 'backup',
						label: deviceTabLabel('backup'),
						disabled: !backupUuid,
						forceRender: true,
						children: (
							<HaGroupNodeVrrpPane
								role="backup"
								ifaces={ifaceMap[String(backupUuid || '')] || []}
								ifaceLoading={ifaceLoadingMap[String(backupUuid || '')]}
								defaultPriority={100}
							/>
						),
					},
				]}
			/>
		</>
	);

	const renderNodeSummary = (role: 'primary' | 'backup', values: HaGroupWizardFormValues) => {
		const node = values[role];
		const uuid = role === 'primary' ? values.primaryUuid : values.backupUuid;
		return (
			<Card
				size="small"
				type="inner"
				title={deviceTabLabel(role)}
				style={{ marginBottom: 12 }}
			>
				<Descriptions size="small" column={1}>
					<Descriptions.Item label="设备">{vrLabel(uuid)}</Descriptions.Item>
					<Descriptions.Item label="VRRP 实例">
						{(node?.instances || []).map((inst, idx) => (
							<div key={`${role}-inst-${idx}`}>
								#{idx + 1} {inst.interface || '—'} · VRID {inst.vrid} · {inst.virtualIp || '—'} · 优先级{' '}
								{inst.priority}
								{inst.advertMode === 'unicast'
									? ` · 单播 ${inst.unicastSource || '—'} → ${inst.unicastPeer || '—'}`
									: ' · 组播'}
								{inst.preempt === false ? ' · 不抢占' : ' · 抢占'}
								{` · 通告 ${inst.advertInterval ?? 1}s`}
							</div>
						))}
					</Descriptions.Item>
					<Descriptions.Item label="组策略">
						{(node?.groups || []).map((group, idx) => (
							<div key={`${role}-grp-${idx}`}>
								#{idx + 1} Group {group.groupId} → 实例 {group.vrrpInstanceId}
								{group.trackGateway ? ` · track ${group.trackGateway}` : ''}
								{` · 间隔 ${group.trackInterval ?? 1}s`}
							</div>
						))}
					</Descriptions.Item>
				</Descriptions>
			</Card>
		);
	};

	const renderStep2 = () => {
		const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
		return (
			<>
				<Alert
					type="info"
					showIcon
					style={{ marginBottom: 16 }}
					message="确认后将保存 HA 组与 VRRP 意图到平台"
					description="状态为「草稿」。下一步再按设备定点合并 interface/vrrp 与 vrrp group 并下发。"
				/>
				<Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
					<Descriptions.Item label="组名称">{values.name || '—'}</Descriptions.Item>
					<Descriptions.Item label="HA 组角色">{sideLabel(values.side)}</Descriptions.Item>
					<Descriptions.Item label="备注">{values.description || '—'}</Descriptions.Item>
					{savedGroup ? (
						<Descriptions.Item label="平台状态">
							<Tag>{savedGroup.status === 'draft' ? '草稿' : savedGroup.status}</Tag>
						</Descriptions.Item>
					) : null}
				</Descriptions>
				{renderNodeSummary('primary', values)}
				{renderNodeSummary('backup', values)}
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
					: '读设备底稿 → 合并接口实例与 vrrp group → CSMCTL 全量 POST',
			done: deployDone,
		},
		{
			title: '校验设备 VRRP',
			desc: '请在 IBR Console 核对接口 vrrp 与 vrrp group；对端 HA 组需另开一次向导',
			done: deployDone,
		},
	];

	const renderStep3 = () => (
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
				description={`${sideLabel(side)} · 主 ${vrLabel(primaryUuid)} / 备 ${vrLabel(backupUuid)}`}
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

	const renderStepContent = () => (
		<>
			<div style={{ display: current === 0 ? 'block' : 'none' }}>{renderStep0()}</div>
			<div style={{ display: current === 1 ? 'block' : 'none' }}>{renderStep1()}</div>
			<div style={{ display: current === 2 ? 'block' : 'none' }}>{renderStep2()}</div>
			<div style={{ display: current === 3 ? 'block' : 'none' }}>{renderStep3()}</div>
		</>
	);

	if (!canWrite) {
		return null;
	}

	return (
		<IbrWizardPage
			title={isEdit ? '配置 IBR 高可用组' : undefined}
			subtitle="一次向导配置本端或对端一组主备；对端请再开一次向导。"
			onBack={() => navigate('/admin/interconnect/ha-groups')}
			layout="linear"
			steps={
				<Steps
					direction="vertical"
					size="small"
					current={current}
					onChange={(idx) => {
						if (idx >= 3 && !platformSaved) {
							message.warning('请先在「确认并保存」中完成保存到平台');
							return;
						}
						if (idx >= 3) {
							setCurrent(idx);
							return;
						}
						void handleWizardStepsChange(idx, current, setCurrent, validateHaStepsThrough);
					}}
					items={STEP_TITLES.map((title, idx) => ({
						title,
						disabled: idx === 3 && !platformSaved,
					}))}
				/>
			}
			main={
				<IbrWizardStepPane
					title={ibrWizardStepCardTitle(current, STEP_TITLES[current])}
					footerLeft={
						<>
							{current !== 3 && (
								<Button onClick={() => navigate('/admin/interconnect/ha-groups')}>返回列表</Button>
							)}
							{current > 0 && current !== 3 && <Button onClick={prev}>上一步</Button>}
							{current === 3 && (
								<Button type="primary" onClick={() => navigate('/admin/interconnect/ha-groups')}>
									关闭向导
								</Button>
							)}
						</>
					}
					footerRight={
						<>
							{current < 2 && (
								<Button type="primary" onClick={() => void next()}>
									下一步
								</Button>
							)}
							{current === 2 && (
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
									<Button type="primary" disabled={!platformSaved} onClick={() => setCurrent(3)}>
										进入下发向导
									</Button>
								</>
							)}
						</>
					}
				>
					<Form form={form} layout="vertical" preserve onValuesChange={onFormValuesChange}>
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
						保存时写入 HA 组的 vrrpIntent；下发时按节点拆成接口实例与 vrrp group。
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
