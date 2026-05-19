import React from 'react';
import { Table } from 'antd';

export type ConflictLikeRecord = Record<string, unknown> & {
  displayName?: string;
  name?: string;
  namespace?: string;
  status?: string;
};

export type RemoveAssignmentConflictProps = {
  errorMsg: string;
  errorDetail?: string;
  vms: ConflictLikeRecord[];
  vmCount: number;
  containers: ConflictLikeRecord[];
  containerCount: number;
  databases: ConflictLikeRecord[];
  databaseCount: number;
  vpcs: ConflictLikeRecord[];
  vpcCount: number;
  volumes: ConflictLikeRecord[];
  volumeCount: number;
};

/** 移除资源池分配失败（409/503）时的详情正文 */
export function RemoveAssignmentConflict({
  errorMsg,
  errorDetail,
  vms,
  vmCount,
  containers,
  containerCount,
  databases,
  databaseCount,
  vpcs,
  vpcCount,
  volumes,
  volumeCount,
}: RemoveAssignmentConflictProps) {
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ marginBottom: 16, color: '#ff4d4f' }}>{errorMsg}</p>
      {errorDetail ? (
        <p style={{ marginBottom: 16, color: '#8c8c8c', fontSize: 12 }}>{errorDetail}</p>
      ) : null}
      {vms.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>虚拟机（{vmCount} 个）</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
            <Table
              size="small"
              dataSource={vms}
              columns={[
                { title: '别名', dataIndex: 'displayName', key: 'displayName', width: 200, ellipsis: true },
                { title: '名称', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
                { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
                { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
              ]}
              pagination={false}
              rowKey={(record: ConflictLikeRecord) =>
                `vm-${record.namespace}/${record.name}`
              }
            />
          </div>
        </div>
      )}
      {containers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>容器负载（{containerCount} 个）</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
            <Table
              size="small"
              dataSource={containers}
              columns={[
                { title: '别名', dataIndex: 'displayName', key: 'displayName', width: 200, ellipsis: true },
                { title: '名称', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
                { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
                { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
              ]}
              pagination={false}
              rowKey={(record: ConflictLikeRecord) =>
                `pod-${record.namespace}/${record.name}`
              }
            />
          </div>
        </div>
      )}
      {databases.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>数据库相关工作负载（{databaseCount} 个）</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
            <Table
              size="small"
              dataSource={databases}
              columns={[
                { title: '别名', dataIndex: 'displayName', key: 'displayName', width: 200, ellipsis: true },
                { title: '名称', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
                { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
                { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
              ]}
              pagination={false}
              rowKey={(record: ConflictLikeRecord) =>
                `db-${record.namespace}/${record.name}`
              }
            />
          </div>
        </div>
      )}
      {vpcs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>VPC 网络（{vpcCount} 个）</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
            <Table
              size="small"
              dataSource={vpcs}
              columns={[
                { title: '别名', dataIndex: 'displayName', key: 'displayName', width: 220, ellipsis: true },
                { title: '名称', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
                { title: 'CIDR', dataIndex: 'cidrBlock', key: 'cidrBlock', width: 160, ellipsis: true },
              ]}
              pagination={false}
              rowKey={(record: ConflictLikeRecord) =>
                `vpc-${record.name || record.displayName}`
              }
            />
          </div>
        </div>
      )}
      {volumes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>存储卷 / 虚拟卷（{volumeCount} 个）</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
            <Table
              size="small"
              dataSource={volumes}
              columns={[
                { title: '别名', dataIndex: 'displayName', key: 'displayName', width: 200, ellipsis: true },
                { title: '名称', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
                { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
                { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
                { title: '大小', dataIndex: 'size', key: 'size', width: 90 },
              ]}
              pagination={false}
              rowKey={(record: ConflictLikeRecord) =>
                `vol-${record.namespace}/${record.name}`
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
