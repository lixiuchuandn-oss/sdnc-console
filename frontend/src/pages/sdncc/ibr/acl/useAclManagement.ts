import { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, message, Modal } from 'antd';
import {
	addACLRuleToGroup,
	bindACLGroupToVR,
	createACLGroup,
	deleteACLGroup,
	deleteACLRule,
	getACLGroups,
	getACLRules,
	unbindACLGroupFromVR,
	type ACLGroup,
	type ACLGroupBinding,
	type ACLRule,
} from '../../../../services/virtualRouterApi';
import { loadIbrVrCatalog, syncAndLoadIbrVrCatalog } from '../lib/ibrVrCatalog';
import { DeployDriftCancelledError, runIbrDeployPushInteractive } from '../lib/vrConfigDeployFlow';

export type AclTabKey = 'groups' | 'rules';

export function useAclManagement(scopedVrUuid?: string) {
	const scopedVr = String(scopedVrUuid || '').trim();
	const [activeTab, setActiveTab] = useState<AclTabKey>('groups');

	const [vrList, setVrList] = useState<any[]>([]);
	const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});

	const [groups, setGroups] = useState<ACLGroup[]>([]);
	const [groupsLoading, setGroupsLoading] = useState(false);
	const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
	const [groupForm] = Form.useForm();

	const [bindDrawerOpen, setBindDrawerOpen] = useState(false);
	const [currentBindingGroup, setCurrentBindingGroup] = useState<ACLGroup | null>(null);
	const [bindForm] = Form.useForm();
	const [bindingSubmitting, setBindingSubmitting] = useState(false);

	const [groupKeyword, setGroupKeyword] = useState('');
	const [groupVrFilter, setGroupVrFilter] = useState<string | undefined>();
	const [groupFilterForm] = Form.useForm();

	const [rules, setRules] = useState<ACLRule[]>([]);
	const [rulesLoading, setRulesLoading] = useState(false);
	const [keyword, setKeyword] = useState('');
	const [vrFilter, setVrFilter] = useState<string | undefined>();
	const [actionFilter, setActionFilter] = useState<'permit' | 'deny' | undefined>();
	const [protocolFilter, setProtocolFilter] = useState<'tcp' | 'udp' | 'icmp' | 'any' | undefined>();
	const [filterForm] = Form.useForm();

	const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
	const [createRuleForm] = Form.useForm();
	const [submitting, setSubmitting] = useState(false);
	const [targetGroup, setTargetGroup] = useState<ACLGroup | null>(null);

	const fetchVRs = useCallback(async (force?: boolean) => {
		try {
			const { vrs, nameMap } = force ? await syncAndLoadIbrVrCatalog() : await loadIbrVrCatalog();
			setVrList(vrs);
			setVrNameMap(nameMap);
		} catch (e) {
			console.error('Failed to fetch VRs from cache', e);
			setVrList([]);
			setVrNameMap({});
		}
	}, []);

	const fetchGroups = useCallback(async (force?: boolean) => {
		setGroupsLoading(true);
		try {
			const res = await getACLGroups(undefined, { skipCache: !!force });
			const list = Array.isArray(res) ? res : (res as { data?: ACLGroup[] })?.data || [];
			setGroups(list);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Unknown error';
			message.error(`加载 ACL 组失败: ${msg}`);
		} finally {
			setGroupsLoading(false);
		}
	}, []);

	const fetchRules = useCallback(async (force?: boolean) => {
		setRulesLoading(true);
		try {
			const list = await getACLRules(undefined, { skipCache: !!force });
			const normalized = Array.isArray(list) ? list : (list as { data?: ACLRule[] })?.data || [];
			setRules(normalized);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Unknown error';
			message.error(`加载 ACL 列表失败: ${msg}`);
		} finally {
			setRulesLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchVRs();
		void fetchGroups();
		void fetchRules();
	}, [fetchGroups, fetchRules, fetchVRs]);

	useEffect(() => {
		if (!scopedVr) return;
		setVrFilter(scopedVr);
		setGroupVrFilter(scopedVr);
		filterForm.setFieldsValue({ vrId: scopedVr });
		groupFilterForm.setFieldsValue({ vrId: scopedVr });
	}, [scopedVr, filterForm, groupFilterForm]);

	const forceRefresh = useCallback(async () => {
		message.loading({ content: '正在同步 IBR 与 ACL 数据...', key: 'acl_refresh' });
		try {
			await fetchVRs(true);
			await fetchGroups(true);
			await fetchRules(true);
			message.success({ content: '同步完成', key: 'acl_refresh' });
		} catch {
			message.error({ content: '同步失败，请稍后重试', key: 'acl_refresh' });
		}
	}, [fetchGroups, fetchRules, fetchVRs]);

	const handleCreateGroup = useCallback(async () => {
		try {
			const values = await groupForm.validateFields();
			setSubmitting(true);
			await createACLGroup(values);
			message.success('ACL 组创建成功');
			setGroupDrawerOpen(false);
			groupForm.resetFields();
			await fetchGroups(true);
		} catch (e: unknown) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			const msg = e instanceof Error ? e.message : String(e);
			message.error(`创建失败: ${msg}`);
		} finally {
			setSubmitting(false);
		}
	}, [fetchGroups, groupForm]);

	const handleDeleteGroup = useCallback(
		(group: ACLGroup, modalClassName?: string) => {
			Modal.confirm({
				className: modalClassName,
				title: '确认删除 ACL 组',
				content: `确定要删除 ACL 组 "${group.name}" 吗？组内的规则也会被删除。同时会解除所有关联的 IBR。`,
				okText: '删除',
				cancelText: '取消',
				okButtonProps: { danger: true },
				onOk: async () => {
					try {
						await deleteACLGroup(group.id);
						message.success('删除成功');
						await fetchGroups(true);
						await fetchRules(true);
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						message.error(`删除失败: ${msg}`);
					}
				},
			});
		},
		[fetchGroups, fetchRules],
	);

	const handleOpenBind = useCallback(
		(group: ACLGroup) => {
			setCurrentBindingGroup(group);
			bindForm.resetFields();
			setBindDrawerOpen(true);
		},
		[bindForm],
	);

	const handleSubmitBind = useCallback(async () => {
		try {
			const values = await bindForm.validateFields();
			setBindingSubmitting(true);
			if (currentBindingGroup) {
				await bindACLGroupToVR(currentBindingGroup.id, values.vrId);
				message.success('关联成功');
				setBindDrawerOpen(false);
				await fetchGroups(true);
			}
		} catch (e: unknown) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			const msg = e instanceof Error ? e.message : String(e);
			message.error(`关联失败: ${msg}`);
		} finally {
			setBindingSubmitting(false);
		}
	}, [bindForm, currentBindingGroup, fetchGroups]);

	const handleUnbind = useCallback(
		(group: ACLGroup, vrId: string, modalClassName?: string) => {
			Modal.confirm({
				className: modalClassName,
				title: '确认解除关联',
				content: '解除关联后，该 ACL 组将不再应用于此 IBR。',
				okText: '解除关联',
				cancelText: '取消',
				onOk: async () => {
					try {
						await unbindACLGroupFromVR(group.id, vrId);
						message.success('解除关联成功');
						await fetchGroups(true);
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						message.error(`解除关联失败: ${msg}`);
					}
				},
			});
		},
		[fetchGroups],
	);

	const handleDeploy = useCallback(
		(vrId: string, options?: { onSuccess?: (text: string) => void; modalClassName?: string }) => {
			if (!vrId) {
				message.error('未关联 IBR，无法下发');
				return;
			}
			const hide = message.loading('正在准备下发...', 0);
			runIbrDeployPushInteractive({ vrId, feature: 'acl' })
				.then((res) => {
					hide();
					const text = JSON.stringify((res as { data?: unknown })?.data ?? res, null, 2);
					if (options?.onSuccess) {
						options.onSuccess(text);
						message.success('下发成功');
						return;
					}
					Modal.success({
						className: options?.modalClassName,
						title: '下发成功',
						content: text,
						width: 600,
					});
				})
				.catch((e: unknown) => {
					hide();
					if (e instanceof DeployDriftCancelledError) {
						message.info('已取消下发');
						return;
					}
					const msg = e instanceof Error ? e.message : String(e);
					Modal.error({ className: options?.modalClassName, title: '下发失败', content: msg });
				});
		},
		[],
	);

	const handleOpenCreateRule = useCallback(
		(group?: ACLGroup) => {
			setTargetGroup(group || null);
			createRuleForm.resetFields();
			if (group?.vrId) {
				createRuleForm.setFieldsValue({ vrId: group.vrId, groupId: group.id });
			} else if (scopedVr) {
				createRuleForm.setFieldsValue({ vrId: scopedVr });
			}
			setRuleDrawerOpen(true);
		},
		[createRuleForm, scopedVr],
	);

	const handleCreateRule = useCallback(async () => {
		try {
			const values = await createRuleForm.validateFields();
			setSubmitting(true);

			if (targetGroup) {
				await addACLRuleToGroup(targetGroup.id, values);
			} else {
				const gid = String((values as { groupId?: string }).groupId || '').trim();
				if (!gid) throw new Error('请选择所属 ACL 组');
				const { groupId: _groupId, ...rest } = values as ACLRule & { groupId?: string };
				await addACLRuleToGroup(gid, rest);
			}

			message.success('规则创建成功');
			setRuleDrawerOpen(false);
			createRuleForm.resetFields();
			await fetchRules(true);
			if (targetGroup) await fetchGroups(true);
		} catch (e: unknown) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			const msg = e instanceof Error ? e.message : String(e);
			message.error(`创建失败: ${msg}`);
		} finally {
			setSubmitting(false);
		}
	}, [createRuleForm, fetchGroups, fetchRules, targetGroup]);

	const handleDeleteRule = useCallback(
		(row: ACLRule, modalClassName?: string) => {
			Modal.confirm({
				className: modalClassName,
				title: '确认删除',
				content: `确定要删除 ACL 规则 "${row.name}" 吗？`,
				okText: '删除',
				cancelText: '取消',
				okButtonProps: { danger: true },
				onOk: async () => {
					try {
						await deleteACLRule(row.id);
						message.success('删除成功');
						await fetchRules(true);
						await fetchGroups(true);
					} catch (error: unknown) {
						const msg = error instanceof Error ? error.message : 'Unknown error';
						message.error(`删除失败: ${msg}`);
					}
				},
			});
		},
		[fetchGroups, fetchRules],
	);

	const openCreateGroup = useCallback(() => {
		groupForm.resetFields();
		if (scopedVr) {
			groupForm.setFieldsValue({ vrId: scopedVr });
		}
		setGroupDrawerOpen(true);
	}, [groupForm, scopedVr]);

	const [createAclForm] = Form.useForm<{ acl_id: string }>();

	/** 控制台「创建 ACL」：仅 ACL 编号，对齐 ibr-local-web */
	const handleCreateAclById = useCallback(async () => {
		try {
			const values = await createAclForm.validateFields();
			const raw = String(values.acl_id ?? '').trim();
			const aclId = Number(raw);
			if (!raw || !Number.isFinite(aclId) || aclId < 1001 || aclId > 4000) {
				message.error('请输入 1001-4000 之间的 ACL 编号');
				return false;
			}
			if (!scopedVr) {
				message.error('未绑定 IBR，无法创建');
				return false;
			}
			setSubmitting(true);
			await createACLGroup({
				name: `ACL-${aclId}`,
				vrId: scopedVr,
				aclId,
				description: '',
			});
			message.success('已创建');
			createAclForm.resetFields();
			await fetchGroups(true);
			return true;
		} catch (e: unknown) {
			if (e && typeof e === 'object' && 'errorFields' in e) return false;
			const msg = e instanceof Error ? e.message : String(e);
			message.error(`创建失败: ${msg}`);
			return false;
		} finally {
			setSubmitting(false);
		}
	}, [createAclForm, fetchGroups, scopedVr]);

	/** 规则 Modal（ibr-local-web 字段）→ Tower ACL 规则 */
	const handleAddRuleFromModal = useCallback(
		async (group: ACLGroup, values: Record<string, unknown>) => {
			const proto = String(values.proto ?? '').trim();
			const sport = String(values.sport ?? '').trim();
			const dport = String(values.dport ?? '').trim();
			if ((proto === 'tcp' || proto === 'udp') && !sport && !dport) {
				message.warning('协议已指定但端口为空，请确认后提交');
			}
			const ruleIdRaw = String(values.rule_id ?? '').trim();
			const priority = ruleIdRaw ? Number(ruleIdRaw) : 100;
			const name = ruleIdRaw ? `rule-${ruleIdRaw}` : `rule-${Date.now()}`;
			setSubmitting(true);
			try {
				await addACLRuleToGroup(group.id, {
					name,
					vrId: group.vrId,
					priority: Number.isFinite(priority) ? priority : 100,
					action: values.match_action as 'permit' | 'deny',
					protocol: (proto || 'any') as 'tcp' | 'udp' | 'icmp' | 'any',
					sourceIp: String(values.source ?? '').trim() || 'any',
					destinationIp: String(values.destination ?? '').trim() || 'any',
					sourcePort: sport || 'any',
					destinationPort: dport || 'any',
				});
				message.success('已添加规则');
				await fetchRules(true);
				await fetchGroups(true);
				return true;
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				message.error(`添加失败: ${msg}`);
				return false;
			} finally {
				setSubmitting(false);
			}
		},
		[fetchGroups, fetchRules],
	);

	const filteredRules = useMemo(
		() =>
			rules.filter((r) => {
				if (scopedVr && r.vrId !== scopedVr) return false;
				if (keyword && !String(r.name || '').toLowerCase().includes(keyword.toLowerCase())) return false;
				if (vrFilter && r.vrId !== vrFilter) return false;
				if (actionFilter && r.action !== actionFilter) return false;
				if (protocolFilter && r.protocol !== protocolFilter) return false;
				return true;
			}),
		[rules, scopedVr, keyword, vrFilter, actionFilter, protocolFilter],
	);

	const filteredGroups = useMemo(
		() =>
			groups.filter((g) => {
				if (scopedVr && g.vrId !== scopedVr) return false;
				if (groupKeyword && !g.name.toLowerCase().includes(groupKeyword.toLowerCase())) return false;
				if (groupVrFilter && g.vrId !== groupVrFilter) return false;
				return true;
			}),
		[groups, groupKeyword, groupVrFilter, scopedVr],
	);

	const resetFilters = useCallback(() => {
		filterForm.resetFields();
		setKeyword('');
		setVrFilter(scopedVr || undefined);
		setActionFilter(undefined);
		setProtocolFilter(undefined);
		if (scopedVr) filterForm.setFieldsValue({ vrId: scopedVr });
	}, [filterForm, scopedVr]);

	const resetGroupFilters = useCallback(() => {
		groupFilterForm.resetFields();
		setGroupKeyword('');
		setGroupVrFilter(scopedVr || undefined);
		if (scopedVr) groupFilterForm.setFieldsValue({ vrId: scopedVr });
	}, [groupFilterForm, scopedVr]);

	return {
		scopedVr,
		activeTab,
		setActiveTab,
		vrList,
		vrNameMap,
		groups,
		groupsLoading,
		rules,
		rulesLoading,
		filteredGroups,
		filteredRules,
		groupKeyword,
		setGroupKeyword,
		groupVrFilter,
		setGroupVrFilter,
		groupFilterForm,
		keyword,
		setKeyword,
		vrFilter,
		setVrFilter,
		actionFilter,
		setActionFilter,
		protocolFilter,
		setProtocolFilter,
		filterForm,
		resetFilters,
		resetGroupFilters,
		forceRefresh,
		groupDrawerOpen,
		setGroupDrawerOpen,
		groupForm,
		ruleDrawerOpen,
		setRuleDrawerOpen,
		createRuleForm,
		submitting,
		targetGroup,
		bindDrawerOpen,
		setBindDrawerOpen,
		currentBindingGroup,
		bindForm,
		bindingSubmitting,
		openCreateGroup,
		handleCreateGroup,
		createAclForm,
		handleCreateAclById,
		handleAddRuleFromModal,
		handleDeleteGroup,
		handleOpenBind,
		handleSubmitBind,
		handleUnbind,
		handleDeploy,
		handleOpenCreateRule,
		handleCreateRule,
		handleDeleteRule,
	};
}

export type UseAclManagementResult = ReturnType<typeof useAclManagement>;

export type { ACLGroup, ACLGroupBinding, ACLRule };
