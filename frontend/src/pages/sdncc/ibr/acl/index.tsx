import React from 'react';
import { Form, Input, Select, Table, Tag, Badge } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import type { ColumnsType } from 'antd/es/table';
import type { IbrSectionEmbedProps } from '../lib/embedProps';
import { AclFormDrawers } from './AclFormDrawers';
import {
	type ACLGroup,
	type ACLGroupBinding,
	type ACLRule,
	useAclManagement,
} from './useAclManagement';

const { Option } = Select;

const ACLPage: React.FC<IbrSectionEmbedProps> = ({ embedded = false, scopedVrUuid }) => {
	const acl = useAclManagement(scopedVrUuid);
	const {
		scopedVr,
		activeTab,
		setActiveTab,
		vrList,
		vrNameMap,
		groupsLoading,
		rulesLoading,
		filteredGroups,
		filteredRules,
		groupFilterForm,
		filterForm,
		forceRefresh,
		openCreateGroup,
		handleOpenCreateRule,
		handleDeleteGroup,
		handleDeleteRule,
		handleDeploy,
		handleOpenBind,
		handleUnbind,
		resetFilters,
		resetGroupFilters,
		setGroupKeyword,
		setGroupVrFilter,
		setKeyword,
		setVrFilter,
		setActionFilter,
		setProtocolFilter,
	} = acl;

	const groupColumns: ColumnsType<ACLGroup> = [
		{ title: '组名称', dataIndex: 'name', key: 'name', fixed: 'left', render: (t) => <b>{t}</b> },
		{
			title: '所属IBR',
			dataIndex: 'vrId',
			key: 'vrId',
			render: (v, r) => {
				const primary = v ? (
					<Tag color="blue" key="primary" style={{ marginRight: 4 }}>
						{vrNameMap[v] || v} (主)
					</Tag>
				) : null;
				const bounds = r.bindings?.map((b: ACLGroupBinding) => (
					<Tag
						color="cyan"
						key={b.id}
						closable
						onClose={() => handleUnbind(r, b.vrId)}
						style={{ marginRight: 4 }}
					>
						{vrNameMap[b.vrId] || b.vrId}
					</Tag>
				));
				return (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
						{primary}
						{bounds}
						{!primary && !bounds?.length && <span style={{ color: '#ccc' }}>未绑定</span>}
					</div>
				);
			},
		},
		{ title: 'ACL ID', dataIndex: 'aclId', key: 'aclId' },
		{ title: '描述', dataIndex: 'description', key: 'description' },
		{
			title: '规则数',
			key: 'rules',
			render: (_v, r) => <Badge count={r.rules?.length || 0} showZero color="blue" />,
		},
		{
			title: '操作',
			key: 'ops',
			fixed: 'right',
			render: (_v, r) => (
				<ResourceActionsDropdown
					items={[
						{ key: 'addRule', label: '添加规则' },
						{ key: 'deploy', label: '下发配置', disabled: !r.vrId },
						{ key: 'bind', label: '关联其他 IBR' },
						{ type: 'divider' },
						{ key: 'delete', label: '删除组', danger: true },
					]}
					onClick={({ key }) => {
						if (key === 'addRule') handleOpenCreateRule(r);
						if (key === 'deploy' && r.vrId) handleDeploy(r.vrId);
						if (key === 'bind') handleOpenBind(r);
						if (key === 'delete') handleDeleteGroup(r);
					}}
					buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
				/>
			),
		},
	];

	const ruleColumns: ColumnsType<ACLRule> = [
		{ title: '优先级', dataIndex: 'priority', key: 'priority', fixed: 'left', sorter: (a, b) => a.priority - b.priority },
		{ title: '名称', dataIndex: 'name', key: 'name' },
		{ title: '所属IBR', dataIndex: 'vrId', key: 'vrId', render: (v) => vrNameMap[v] || v },
		{
			title: '所属组',
			dataIndex: 'group',
			key: 'group',
			render: (g) => (g ? <Tag color="blue">{g.name}</Tag> : '-'),
		},
		{
			title: '动作',
			dataIndex: 'action',
			key: 'action',
			render: (act) => <Tag color={act === 'permit' ? 'green' : 'red'}>{act.toUpperCase()}</Tag>,
		},
		{
			title: '协议',
			dataIndex: 'protocol',
			key: 'protocol',
			render: (p) => <Tag>{p.toUpperCase()}</Tag>,
		},
		{ title: '源IP', dataIndex: 'sourceIp', key: 'sourceIp' },
		{ title: '目的IP', dataIndex: 'destinationIp', key: 'destinationIp' },
		{ title: '源端口', dataIndex: 'sourcePort', key: 'sourcePort' },
		{ title: '目的端口', dataIndex: 'destinationPort', key: 'destinationPort' },
		{
			title: '操作',
			key: 'ops',
			fixed: 'right',
			render: (_v, row) => (
				<ResourceActionsDropdown
					items={[{ key: 'delete', label: '删除', danger: true }]}
					onClick={({ key }) => {
						if (key === 'delete') handleDeleteRule(row);
					}}
					buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
				/>
			),
		},
	];

	if (embedded) {
		return null;
	}

	return (
		<PageContainer
			titleLevel={3}
			asCard={false}
			onRefresh={forceRefresh}
			primaryAction={
				activeTab === 'groups'
					? { text: '新建 ACL 组', onClick: openCreateGroup, type: 'primary' }
					: { text: '新建 ACL 规则', onClick: () => handleOpenCreateRule(), type: 'primary' }
			}
			tabList={[
				{ key: 'groups', tab: 'ACL 组管理' },
				{ key: 'rules', tab: '所有规则列表' },
			]}
			tabActiveKey={activeTab}
			onTabChange={(key) => setActiveTab(key as 'groups' | 'rules')}
			toolbarLeft={
				(activeTab === 'groups' && (
					<Form
						className="toolbar-container"
						form={groupFilterForm}
						layout="inline"
						style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
						onValuesChange={(_, all) => {
							setGroupKeyword(all.keyword || '');
							setGroupVrFilter(all.vrId || undefined);
						}}
					>
						<Form.Item name="keyword" style={{ marginBottom: 0 }}>
							<Input
								allowClear
								placeholder="组名称"
								className="toolbar-search"
								suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
							/>
						</Form.Item>
						{!scopedVr && (
							<Form.Item name="vrId" style={{ marginBottom: 0 }}>
								<Select allowClear placeholder="所属 IBR" className="toolbar-filter-sm">
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
						)}
						<button type="button" className="toolbar-reset-btn" onClick={resetGroupFilters}>
							重置
						</button>
					</Form>
				)) ||
				(activeTab === 'rules' && (
					<Form
						className="toolbar-container"
						form={filterForm}
						layout="inline"
						style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
						onValuesChange={(_, all) => {
							setKeyword(all.keyword || '');
							setVrFilter(all.vrId || undefined);
							setActionFilter(all.action || undefined);
							setProtocolFilter(all.protocol || undefined);
						}}
					>
						<Form.Item name="keyword" style={{ marginBottom: 0 }}>
							<Input
								allowClear
								placeholder="规则名称"
								className="toolbar-search"
								suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
							/>
						</Form.Item>
						{!scopedVr && (
							<Form.Item name="vrId" style={{ marginBottom: 0 }}>
								<Select allowClear placeholder="所属 IBR" className="toolbar-filter-sm">
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
						)}
						<Form.Item name="action" style={{ marginBottom: 0 }}>
							<Select allowClear placeholder="动作" className="toolbar-filter-sm">
								<Option value="permit">Permit</Option>
								<Option value="deny">Deny</Option>
							</Select>
						</Form.Item>
						<Form.Item name="protocol" style={{ marginBottom: 0 }}>
							<Select allowClear placeholder="协议" className="toolbar-filter-sm">
								<Option value="any">Any</Option>
								<Option value="tcp">TCP</Option>
								<Option value="udp">UDP</Option>
								<Option value="icmp">ICMP</Option>
							</Select>
						</Form.Item>
						<button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
							重置
						</button>
					</Form>
				))
			}
		>
			{activeTab === 'groups' && (
				<Table
					dataSource={filteredGroups}
					columns={groupColumns}
					rowKey="id"
					loading={groupsLoading}
					bordered={false}
					className="std-table"
					scroll={{ x: true }}
					pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
					expandable={{
						expandedRowRender: (record) => (
							<div style={{ margin: 0 }}>
								<p style={{ marginBottom: 8 }}>
									<b>{record.name} 的规则列表:</b>
								</p>
								<Table
									bordered={false}
									className="std-table"
									columns={ruleColumns.filter((c) => c.key !== 'group' && c.key !== 'vrId')}
									dataSource={record.rules || []}
									rowKey="id"
									pagination={false}
									scroll={{ x: true }}
								/>
							</div>
						),
						rowExpandable: (record) => (record.rules?.length || 0) > 0,
					}}
				/>
			)}

			{activeTab === 'rules' && (
				<Table
					dataSource={filteredRules}
					columns={ruleColumns}
					rowKey="id"
					loading={rulesLoading}
					bordered={false}
					className="std-table"
					pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
					scroll={{ x: true }}
				/>
			)}

			<AclFormDrawers
				variant="page"
				vrList={vrList}
				vrNameMap={vrNameMap}
				groups={acl.groups}
				scopedVr={scopedVr}
				groupDrawerOpen={acl.groupDrawerOpen}
				setGroupDrawerOpen={acl.setGroupDrawerOpen}
				groupForm={acl.groupForm}
				submitting={acl.submitting}
				onCreateGroup={() => void acl.handleCreateGroup()}
				ruleDrawerOpen={acl.ruleDrawerOpen}
				setRuleDrawerOpen={acl.setRuleDrawerOpen}
				createRuleForm={acl.createRuleForm}
				targetGroup={acl.targetGroup}
				onCreateRule={() => void acl.handleCreateRule()}
				bindDrawerOpen={acl.bindDrawerOpen}
				setBindDrawerOpen={acl.setBindDrawerOpen}
				currentBindingGroup={acl.currentBindingGroup}
				bindForm={acl.bindForm}
				bindingSubmitting={acl.bindingSubmitting}
				onSubmitBind={() => void acl.handleSubmitBind()}
			/>
		</PageContainer>
	);
};

export default ACLPage;
