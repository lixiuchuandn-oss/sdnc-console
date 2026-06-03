/**
 * 集群 · 计算配置（Cloudmap `cluster/compute_cluster`）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageDetailSection from 'components/PageDetailSection';
import {
  canReadComputeCluster,
  canReadDrsTab,
  canReadFailureDomainsTab,
  canReadMigrationsTab,
} from 'constants/computeClusterPermissions';
import type { HarvesterSectionOnRefresh } from '../../ceph/lib/cephSectionRefresh';
import NodesSection from './NodesSection';
import FailureDomainSection from './FailureDomainSection';
import DrsRulesSection from './DrsRulesSection';
import DrsMigrationsSection from './DrsMigrationsSection';
import { useFailureDomainsData } from '../hooks/useFailureDomainsData';
import { useDrsSectionData } from '../hooks/useDrsSectionData';
import type { NodeRow } from '../lib/nodesSectionUtils';
import ComputeClusterStatusHero from './computeCluster/ComputeClusterStatusHero';
import {
  parseComputeClusterOperateTabKey,
  type ComputeClusterOperateTabKey,
} from './computeCluster/computeClusterUiConstants';

export type ComputeClusterSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  nodes: NodeRow[];
  nodesLoading: boolean;
  nodesOnRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
  initialOperateTab?: ComputeClusterOperateTabKey;
};

const ComputeClusterSection: React.FC<ComputeClusterSectionProps> = ({
  cloudId,
  checkPerm,
  nodes,
  nodesLoading,
  nodesOnRefresh,
  isTenant = false,
  initialOperateTab,
}) => {
  const canRead = canReadComputeCluster(checkPerm);
  const [searchParams] = useSearchParams();
  const operateTabFromQuery = parseComputeClusterOperateTabKey(searchParams.get('operateTab'));
  const [operateTabKey, setOperateTabKey] = useState<ComputeClusterOperateTabKey>('nodes');

  useEffect(() => {
    setOperateTabKey(initialOperateTab ?? operateTabFromQuery ?? 'nodes');
  }, [cloudId, initialOperateTab, operateTabFromQuery]);

  const canReadFd = canReadFailureDomainsTab(checkPerm);
  const canReadDrs = canReadDrsTab(checkPerm);
  const canReadMig = canReadMigrationsTab(checkPerm);

  const { loading: fdLoading, overview: fdOverview } = useFailureDomainsData(cloudId, canReadFd);
  const { loading: drsLoading, summary: drsSummary } = useDrsSectionData(cloudId, canReadDrs);

  const heroStats = useMemo(
    () => ({
      nodeCount: nodes?.length ?? 0,
      failureDomainCount: fdOverview?.domains?.length ?? 0,
      drsRuleCount: drsSummary.metricRuleCount ?? 0,
      migrationCount: drsSummary.reallocationMigrationCount ?? 0,
      enabledDrsRuleCount: drsSummary.enabledMetricRuleCount,
      runningMigrationCount: drsSummary.runningReallocationMigrationCount,
    }),
    [nodes, fdOverview, drsSummary],
  );

  const tabItems = useMemo(
    () =>
      [
        {
          key: 'nodes' as const,
          label: '计算节点',
          visible: true,
          children: (
            <NodesSection
              nodes={nodes}
              loading={nodesLoading}
              onRefresh={nodesOnRefresh}
              cloudId={cloudId}
              isTenant={isTenant}
              checkPerm={checkPerm}
            />
          ),
        },
        {
          key: 'failure_domains' as const,
          label: '故障域',
          visible: canReadFd,
          children: <FailureDomainSection cloudId={cloudId} checkPerm={checkPerm} />,
        },
        {
          key: 'drs_rules' as const,
          label: 'DRS 规则',
          visible: canReadDrs,
          children: <DrsRulesSection cloudId={cloudId} checkPerm={checkPerm} />,
        },
        {
          key: 'migrations' as const,
          label: `迁移记录 (${heroStats.migrationCount})`,
          visible: canReadMig,
          children: (
            <DrsMigrationsSection cloudId={cloudId} checkPerm={checkPerm} isTenant={isTenant} />
          ),
        },
      ].filter((item) => item.visible),
    [
      canReadFd,
      canReadDrs,
      canReadMig,
      checkPerm,
      cloudId,
      heroStats.migrationCount,
      isTenant,
      nodes,
      nodesLoading,
      nodesOnRefresh,
    ],
  );

  useEffect(() => {
    if (!tabItems.some((item) => item.key === operateTabKey)) {
      setOperateTabKey((tabItems[0]?.key as ComputeClusterOperateTabKey) ?? 'nodes');
    }
  }, [operateTabKey, tabItems]);

  if (!canRead) {
    return (
      <PageDetailSection contentPadding={16}>
        <Alert type="warning" showIcon message="无权限查看计算配置" />
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection contentPadding={16}>
      <ComputeClusterStatusHero loading={nodesLoading || fdLoading || drsLoading} stats={heroStats} />
      <Tabs
        activeKey={operateTabKey}
        onChange={(key) => setOperateTabKey(key as ComputeClusterOperateTabKey)}
        items={tabItems.map(({ key, label, children }) => ({ key, label, children }))}
      />
    </PageDetailSection>
  );
};

export default ComputeClusterSection;
