/**
 * 探测数据加载/空态占位，通过后再渲染子内容。
 */
import React from 'react';
import { Alert, Button, Flex, Spin } from 'antd';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';

export type PhysicalSwitchProbeGateProps = {
  loading: boolean;
  error: string | null;
  record: AswCtlSwitchProbeRecord | null;
  cacheSyncedAt?: string | null;
  canSync?: boolean;
  onLiveProbe?: () => void;
  children: React.ReactNode;
};

const PhysicalSwitchProbeGate: React.FC<PhysicalSwitchProbeGateProps> = ({
  loading,
  error,
  record,
  cacheSyncedAt,
  canSync = false,
  onLiveProbe,
  children,
}) => {
  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin tip="加载运行状态…" />
      </Flex>
    );
  }
  if (error) {
    return <Alert type="warning" showIcon message="无法加载运行状态" description={error} />;
  }
  if (!record) {
    return (
      <Alert
        type="info"
        showIcon
        message="暂无与该管理地址匹配的探测数据"
        description={
          <>
            <div>
              HSM 需先读取 Switch CR 并完成探测后，此处才会展示型号、接口与 CLI 回显。
              {cacheSyncedAt ? (
                <>
                  <br />
                  末次入库时间：{cacheSyncedAt}
                </>
              ) : null}
            </div>
            {canSync && onLiveProbe ? (
              <Button
                type="link"
                size="small"
                style={{ paddingLeft: 0, marginTop: 8 }}
                onClick={onLiveProbe}
              >
                立即探测
              </Button>
            ) : null}
          </>
        }
      />
    );
  }
  return <>{children}</>;
};

export default PhysicalSwitchProbeGate;
