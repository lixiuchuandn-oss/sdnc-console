/**
 * Harvester 容器任务视图：Job / CronJob 切换与列表入口。
 */
import React, { useState, useMemo } from 'react';
import { Segmented } from 'antd';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import JobTable from '../components/jobs/JobTable';
import CronJobTable from '../components/jobs/CronJobTable';

export type JobsSectionProps = {
  jobs: any[];
  cronjobs: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  imagePullSecrets?: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  createDefaultNamespace?: string;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
};

const JobsSection: React.FC<JobsSectionProps> = ({
  jobs,
  cronjobs,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  imagePullSecrets = [],
  secretsWithCredentials = [],
  createDefaultNamespace,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const [activeTab, setActiveTab] = useState<'job' | 'cronjob'>('job');
  const [jobCreateVisible, setJobCreateVisible] = useState(false);
  const [cronjobCreateVisible, setCronjobCreateVisible] = useState(false);

  const filteredJobs = useMemo(() => {
    if (!nsValue) return jobs;
    return jobs.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [jobs, nsValue]);

  const filteredCronJobs = useMemo(() => {
    if (!nsValue) return cronjobs;
    return cronjobs.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [cronjobs, nsValue]);

  return (
    <PageDetailSection asCard={false}>
      <Segmented
        style={{ marginBottom: 12 }}
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'job' | 'cronjob')}
        options={[
          { label: `一次性任务 (${filteredJobs.length})`, value: 'job' },
          { label: `定时任务 (${filteredCronJobs.length})`, value: 'cronjob' },
        ]}
      />
      {activeTab === 'job' ? (
        <JobTable
          key="job"
          data={filteredJobs}
          loading={loading}
          cloudId={cloudId}
          onRefresh={onRefresh}
          namespacesOptions={namespacesOptions}
          nsValue={nsValue}
          onNsChange={onNsChange}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          defaultNamespace={formDefaultNs}
          createModalVisible={jobCreateVisible}
          onCreateModalChange={setJobCreateVisible}
          showAllSwitch={showAllSwitch}
          queryAll={queryAll}
          onQueryAllChange={onQueryAllChange}
        />
      ) : (
        <CronJobTable
          key="cronjob"
          data={filteredCronJobs}
          loading={loading}
          cloudId={cloudId}
          onRefresh={onRefresh}
          namespacesOptions={namespacesOptions}
          nsValue={nsValue}
          onNsChange={onNsChange}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          defaultNamespace={formDefaultNs}
          createModalVisible={cronjobCreateVisible}
          onCreateModalChange={setCronjobCreateVisible}
          showAllSwitch={showAllSwitch}
          queryAll={queryAll}
          onQueryAllChange={onQueryAllChange}
        />
      )}
    </PageDetailSection>
  );
};

export default JobsSection;
