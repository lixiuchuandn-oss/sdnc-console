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
import { fetchSrv6Tunnels, getApiErrorMessage } from '../../../../services/api';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
	createIbrHaGroup,
	fetchIbrHaGroup,
	fetchIbrHaGroups,
	replaceIbrHaGroupMembers,
	updateIbrHaGroup,
	type IbrHaGroup,
} from '../../../../services/ibrHaGroupApi';
import { fetchVrCacheMerged } from '../../../../services/virtualRouterApi';
import {
	evaluateHaMembersAgainstTunnels,
	type Srv6TunnelEndpointLite,
} from './haGroupTunnelGate';
import {
	applyIbrVrRolesToRows,
	buildIbrVrRolesMapFromVr2,
	ibrVrRowId,
	ibrVrRowName,
	loadIbrVrCatalog,
} from '../lib/ibrVrCatalog';
import IbrDeployWizardPanel from '../lib/IbrDeployWizardPanel';
import IbrWizardCard, { ibrWizardStepCardTitle } from '../lib/IbrWizardCard';
import IbrWizardPage from '../lib/IbrWizardPage';
import IbrWizardStepPane from '../lib/IbrWizardStepPane';
import { useIbrDeployWizard } from '../lib/useIbrDeployWizard';
import HaGroupNodeVrrpPane from './HaGroupNodeVrrpPane';
import {
	HA_GROUP_MEMBER_SCOPE_HINT,
	HA_GROUP_WIZARD_DEFAULTS,
	HA_SIDE_OPTIONS,
	buildHaGroupVrrpIntent,
	collectHaDeviceIfaces,
	createDefaultNodeVrrp,
	decorateOccupiedHaVrOptions,
	generateHaGroupName,
	haGroupEligibleRoleLabel,
	isAutoHaGroupName,
	isHaGroupEligibleIbrRole,
	lookupIfaceIpv4,
	matchPeerInstance,
	occupiedHaMemberIndex,
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
	const [haGroupList, setHaGroupList] = useState<IbrHaGroup[]>([]);
	const [previewKey, setPreviewKey] = useState(0);
	const [deviceTab, setDeviceTab] = useState<'primary' | 'backup'>('primary');
	const [ifaceMap, setIfaceMap] = useState<Record<string, HaDeviceIface[]>>({});
	const [ifaceLoadingMap, setIfaceLoadingMap] = useState<Record<string, boolean>>({});
	const [tunnelEndpoints, setTunnelEndpoints] = useState<Srv6TunnelEndpointLite[]>([]);
	const deployAutoStartedRef = useRef(false);

	const primaryUuid = Form.useWatch('primaryUuid', form);
	const backupUuid = Form.useWatch('backupUuid', form);
	const side = Form.useWatch('side', form) as HaGroupSide | undefined;

	const memberTunnelGate = useMemo(
		() =>
			evaluateHaMembersAgainstTunnels(
				tunnelEndpoints,
				String(primaryUuid || ''),
				String(backupUuid || ''),
			),
		[backupUuid, primaryUuid, tunnelEndpoints],
	);

	const occupiedMembers = useMemo(
		() => occupiedHaMemberIndex(haGroupList, editId),
		[editId, haGroupList],
	);

	const freeVrCount = useMemo(
		() => vrOptions.filter((opt) => !occupiedMembers.has(opt.value)).length,
		[occupiedMembers, vrOptions],
	);

	const primaryVrOptions = useMemo(
		() =>
			decorateOccupiedHaVrOptions(
				vrOptions.filter((opt) => opt.value !== backupUuid),
				occupiedMembers,
			),
		[backupUuid, occupiedMembers, vrOptions],
	);

	const backupVrOptions = useMemo(
		() =>
			decorateOccupiedHaVrOptions(
				vrOptions.filter((opt) => opt.value !== primaryUuid),
				occupiedMembers,
			),
		[occupiedMembers, primaryUuid, vrOptions],
	);

	const resolveHaDeployEndpoints = useCallback(() => {
		const groupId = String(savedGroup?.id || editId || '').trim();
		const labelOf = (uuid: string | undefined, fallback: string) => {
			const id = String(uuid || '').trim();
			if (!id) return fallback;
			const role = vrRoleMap[id];
			const roleSuffix = role ? ` [${haGroupEligibleRoleLabel(role)}]` : '';
			const mgmt = vrMgmtMap[id];
			return `${vrNameMap[id] || id}${roleSuffix}${mgmt ? ` · ${mgmt}` : ''}`;
		};
		return [
			{
				label: `${labelOf(primaryUuid, '主节点')}（主）`,
				vrId: String(primaryUuid || ''),
				meta: { haGroupId: groupId, haRole: 'primary' as const },
			},
			{
				label: `${labelOf(backupUuid, '备节点')}（备）`,
				vrId: String(backupUuid || ''),
				meta: { haGroupId: groupId, haRole: 'backup' as const },
			},
		];
	}, [backupUuid, editId, primaryUuid, savedGroup?.id, vrMgmtMap, vrNameMap, vrRoleMap]);

	const haDeployWizard = useIbrDeployWizard({
		feature: 'vrrp',
		resolveEndpoints: resolveHaDeployEndpoints,
		onAllFinished: () => {
			message.success('主备 VRRP 下发流程已执行完毕');
			const groupId = String(savedGroup?.id || editId || '').trim();
			if (!groupId) return;
			void fetchIbrHaGroup(groupId)
				.then((group) => setSavedGroup(group))
				.catch(() => undefined);
		},
	});

	const deployBusy = haDeployWizard.steps.some((_, i) => haDeployWizard.status[i] === 'process');

	const catalogLoadGenRef = useRef(0);
	const editLoadGenRef = useRef(0);
	const ifaceLoadGenRef = useRef<Record<string, number>>({});

	const loadTunnelEndpoints = useCallback(async () => {
		try {
			const list = await fetchSrv6Tunnels({ skipCache: true, includeHealth: false });
			const rows = Array.isArray(list) ? list : [];
			setTunnelEndpoints(
				rows.map((t: any) => ({
					id: String(t?.id || ''),
					name: String(t?.name || t?.id || ''),
					peA: t?.peA,
					peB: t?.peB,
					ceA: t?.ceA,
					ceB: t?.ceB,
				})),
			);
		} catch {
			setTunnelEndpoints([]);
		}
	}, []);

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

	const loadHaGroups = useCallback(async () => {
		try {
			const groups = await fetchIbrHaGroups({ skipCache: true });
			setHaGroupList(groups);
		} catch {
			setHaGroupList([]);
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
		void loadTunnelEndpoints();
		void loadHaGroups();
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
	}, [form, isEdit, loadExistingGroup, loadHaGroups, loadTunnelEndpoints, loadVrCatalog]);

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

	const occupiedMemberError = (values: HaGroupWizardFormValues): string | null => {
		const primaryOwner = occupiedMembers.get(String(values.primaryUuid || '').trim());
		if (primaryOwner) return `主节点已属于高可用组「${primaryOwner}」`;
		const backupOwner = occupiedMembers.get(String(values.backupUuid || '').trim());
		if (backupOwner) return `备节点已属于高可用组「${backupOwner}」`;
		return null;
	};

	const validateHaStepsThrough = (from: number, to: number) =>
		validateWizardStepsThrough(form, from, to, haFieldsForStep, {
			beforeAdvance: async (step) => {
				if (step === 0) {
					const values = form.getFieldsValue(true) as HaGroupWizardFormValues;
					const occupiedErr = occupiedMemberError(values);
					if (occupiedErr) {
						message.error(occupiedErr);
						return false;
					}
					return true;
				}
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
				const occupiedErr = occupiedMemberError(values);
				if (occupiedErr) {
					message.error(occupiedErr);
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
			const occupiedErr = occupiedMemberError(values);
			if (occupiedErr) {
				message.error(occupiedErr);
				return;
			}
			const gate = evaluateHaMembersAgainstTunnels(
				tunnelEndpoints,
				values.primaryUuid,
				values.backupUuid,
			);
			if (gate.hardError) {
				message.error(gate.hardError);
				return;
			}
			setLoading(true);
			const vrrpIntent = buildHaGroupVrrpIntent(values);
			let writeWarnings: string[] = [];
			if (isEdit && editId) {
				const currentPrimary = memberByRole(savedGroup, 'primary')?.vrUuid;
				const currentBackup = memberByRole(savedGroup, 'backup')?.vrUuid;
				if (
					currentPrimary &&
					currentBackup &&
					(currentPrimary !== values.primaryUuid || currentBackup !== values.backupUuid)
				) {
					const replaced = await replaceIbrHaGroupMembers(editId, {
						primaryUuid: values.primaryUuid,
						backupUuid: values.backupUuid,
					});
					writeWarnings = replaced.warnings;
					setSavedGroup(replaced.group);
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
				writeWarnings = created.warnings;
				setSavedGroup(created.group);
				navigate(`/admin/interconnect/ha-groups/${created.group.id}/wizard`, { replace: true });
			}
			setPlatformSaved(true);
			void loadHaGroups();
			message.success(isEdit ? 'HA 组已更新' : 'HA 组已创建（草稿）');
			const tips = writeWarnings.length ? writeWarnings : gate.warnings;
			tips.forEach((w) => message.warning(w, 8));
			refreshPreview();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '保存失败'));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (current !== 3) {
			deployAutoStartedRef.current = false;
			haDeployWizard.cancel();
			return;
		}
		const groupId = String(savedGroup?.id || editId || '').trim();
		if (!groupId) return;
		if (deployAutoStartedRef.current) return;
		deployAutoStartedRef.current = true;
		// 已配置组进入本步只展示步骤，不自动推设备；改意图保存后状态会回草稿并自动下发
		if (savedGroup?.status === 'configured') {
			haDeployWizard.resetWizard();
			return;
		}
		haDeployWizard.startAuto();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在进入第 4 步时触发自动下发链
	}, [current, editId, savedGroup?.id, savedGroup?.status]);

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
			{freeVrCount < 2 ? (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					message="可选实例不足"
					description={
						vrOptions.length < 2
							? '至少需要 2 台 CE 或标准模式 IBR。请确认 CSMCTL 可达且 VR2 配置中已写入 role 字段。'
							: '至少需要 2 台尚未编入其它高可用组的 CE 或标准模式 IBR。已占用的设备会在下拉中禁用。'
					}
				/>
			) : null}
			{memberTunnelGate.hardError ? (
				<Alert
					type="error"
					showIcon
					style={{ marginBottom: 16 }}
					message="不能组成 HA 组"
					description={memberTunnelGate.hardError}
				/>
			) : null}
			{!memberTunnelGate.hardError && memberTunnelGate.warnings.length ? (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					message="成员已被隧道引用"
					description={
						<ul style={{ margin: 0, paddingLeft: 18 }}>
							{memberTunnelGate.warnings.map((w) => (
								<li key={w}>{w}</li>
							))}
						</ul>
					}
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
							options={primaryVrOptions}
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
							options={backupVrOptions}
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

	const renderStep3 = () => (
		<>
			<Alert
				type={savedGroup?.status === 'configured' ? 'success' : 'info'}
				showIcon
				style={{ marginBottom: 16 }}
				message={
					savedGroup?.status === 'configured'
						? '主备 VRRP 可重复下发；重新下发会再次预览并推送两端'
						: '进入本步后按「预览主 → 下发主 → 预览备 → 下发备」执行，日志中可见本组组装片'
				}
				description={`${sideLabel(side)} · 主 ${vrLabel(primaryUuid)} / 备 ${vrLabel(backupUuid)}`}
			/>
			{savedGroup?.status === 'degraded' ? (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					message="组状态为降级"
					description="主节点可能已下发、备节点未成功。可点失败步骤「执行」重试，或「重新下发」整链重跑。"
				/>
			) : null}
			<IbrDeployWizardPanel
				title="下发向导"
				hint="与 SRv6 隧道向导相同：每步日志展示将写入或已推送的内容。失败可点该步「执行」重试；也可点「重新下发」整链重跑。"
				headerExtra={
					<Button size="small" disabled={deployBusy || !savedGroup} onClick={() => haDeployWizard.startAuto()}>
						重新下发
					</Button>
				}
				steps={haDeployWizard.steps}
				activeStep={haDeployWizard.activeStep}
				logs={haDeployWizard.logs}
				status={haDeployWizard.status}
				onRunStep={(idx) => void haDeployWizard.runStep(idx)}
			/>
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
								<Button
									type="primary"
									disabled={deployBusy}
									onClick={() => navigate('/admin/interconnect/ha-groups')}
								>
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
