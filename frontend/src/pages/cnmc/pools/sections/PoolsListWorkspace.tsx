/**
 * 云资源池列表视图（逻辑：`hooks/usePoolsListPage.tsx`）。
 */
import React from 'react';
import { Button, Col, Dropdown, Form, Input, Row, Select, Table } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageContainer from '../../../../components/PageContainer';
import WriteGuard from '../../../../components/WriteGuard';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import CloudEditModal from '../../clouds/Harvester/ecs/modals/CloudEditModal';
import CloudWizard from '../modals/CloudWizard';
import type { CloudProvider } from '../lib/poolProviders';
import { usePoolsListPage } from '../hooks/usePoolsListPage';
import { PoolsMetricCard } from './PoolsMetricCard';

export default function PoolsListWorkspace() {
  const {
    canWriteClouds,
    filterForm,
    handleFilterChange,
    resetToolbarFilters,
    bulkActionsMenu,
    refreshList,
    totalCnt,
    onlineCnt,
    offlineCnt,
    containerCounts,
    vmCounts,
    vpcCounts,
    wizardVisible,
    setWizardVisible,
    editModalVisible,
    setEditModalVisible,
    editingCloud,
    setEditingCloud,
    activeColumns,
    filteredClouds,
    selectedRowKeys,
    setSelectedRowKeys,
    tableColumns,
    CLOUD_STATUS_MAP,
    CLOUD_TYPE_MAP,
    cloudProviders,
    fetchClouds,
    reloadSummaryClouds,
  } = usePoolsListPage();

  return (
    <PageContainer
      titleLevel={3}
      collapsibleChildren={
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <PoolsMetricCard
              title="资源池数量"
              total={totalCnt}
              unit="个"
              used={onlineCnt}
              midLabel="离线"
              midValue={offlineCnt}
              usedLabel="在线"
              mainColor="#1677ff"
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <PoolsMetricCard
              title="云主机数量"
              total={vmCounts.total}
              unit="个"
              used={vmCounts.online}
              midLabel="离线"
              midValue={vmCounts.offline}
              usedLabel="在线"
              mainColor="#1677ff"
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <PoolsMetricCard
              title="容器集群数量"
              total={containerCounts.total}
              unit="个"
              used={containerCounts.online}
              midLabel="离线"
              midValue={containerCounts.offline}
              usedLabel="在线"
              mainColor="#1677ff"
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <PoolsMetricCard
              title="VPC 网络数量"
              total={vpcCounts.total}
              unit="个"
              used={vpcCounts.online}
              midLabel="未就绪"
              midValue={vpcCounts.offline}
              usedLabel="就绪"
              mainColor="#1677ff"
            />
          </Col>
        </Row>
      }
      asCard={false}
      toolbarLeft={
        <Form className="toolbar-container" form={filterForm} layout="vertical" onValuesChange={handleFilterChange}>
          <Form.Item name="keyword">
            <Input
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              allowClear
              placeholder="关键字"
            />
          </Form.Item>
          <Form.Item name="vendor">
            <Select className="toolbar-filter-sm" allowClear placeholder="供应商">
              {cloudProviders.map((p: CloudProvider) => (
                <Select.Option key={p.id} value={p.id}>
                  {p.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="status">
            <Select className="toolbar-filter-sm" allowClear placeholder="状态">
              {(Object.keys(CLOUD_STATUS_MAP) as (keyof typeof CLOUD_STATUS_MAP)[]).map((key) => (
                <Select.Option key={key} value={key}>
                  {CLOUD_STATUS_MAP[key]}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="category">
            <Select className="toolbar-filter-sm" allowClear placeholder="类型">
              {(Object.keys(CLOUD_TYPE_MAP) as (keyof typeof CLOUD_TYPE_MAP)[]).map((key) => (
                <Select.Option key={key} value={key}>
                  {CLOUD_TYPE_MAP[key]}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="link" className="toolbar-reset-btn" onClick={resetToolbarFilters}>
              重置
            </Button>
          </Form.Item>
        </Form>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <WriteGuard canWrite={canWriteClouds}>
            <Button type="primary" onClick={() => setWizardVisible(true)}>
              新增资源池
            </Button>
          </WriteGuard>
          <WriteGuard canWrite={canWriteClouds}>
            <Dropdown menu={bulkActionsMenu}>
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
          </WriteGuard>
          <TableColumnSettingsButton allColumns={tableColumns} settingsKey="clouds-list" />
          <Button icon={<ReloadOutlined />} onClick={refreshList} />
        </div>
      }
      actionsSize="middle"
    >
      <Table
        className="std-table"
        bordered={false}
        columns={activeColumns}
        dataSource={filteredClouds}
        rowKey="id"
        rowSelection={
          canWriteClouds
            ? {
                selectedRowKeys,
                onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
              }
            : undefined
        }
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: 'max-content' }}
        tableLayout="auto"
      />

      <CloudWizard
        visible={wizardVisible}
        onCancel={() => setWizardVisible(false)}
        onSuccess={() => {
          void fetchClouds(true);
          reloadSummaryClouds?.();
        }}
      />

      <CloudEditModal
        visible={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingCloud(null);
        }}
        onSuccess={() => {
          setEditModalVisible(false);
          setEditingCloud(null);
          void fetchClouds(true);
          reloadSummaryClouds?.();
        }}
        cloud={editingCloud}
      />
    </PageContainer>
  );
}
