import React from 'react';
import MonitoringOverview from '../../../Harvester/monitoring/MonitoringOverview';

export type CloudmapOverviewTabProps = {
  cloudId: string;
};

/** Cloudmap \u8be6\u60c5\u9875 \u2014 \u8d44\u6e90\u603b\u89c8 Tab */
const CloudmapOverviewTab: React.FC<CloudmapOverviewTabProps> = ({
  cloudId,
}) => <MonitoringOverview cloudId={cloudId} />;

export default CloudmapOverviewTab;
