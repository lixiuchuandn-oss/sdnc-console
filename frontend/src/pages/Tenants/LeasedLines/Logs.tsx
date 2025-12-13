import React, { useEffect, useState } from 'react';
import { Button, Modal, Space as AntSpace, Table, Upload, message, Dropdown } from 'antd';
import { UploadOutlined, ReloadOutlined, EllipsisOutlined } from '@ant-design/icons';
import { uploadSecurityLogs, listSecurityLogs } from '../../../services/systemApi';

const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [logsUploading, setLogsUploading] = useState(false);
  const [logsFileList, setLogsFileList] = useState<any[]>([]);

  const fetchLogs = async () => {
    try {
      setLogsLoading(true);
      const r = await listSecurityLogs();
      setLogs(r?.logs || []);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '获取日志文件失败');
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => { if (timer) clearInterval(timer); };
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <AntSpace>
          <Dropdown
            menu={{
              items: [
                { key: 'upload', label: '上传日志文件', icon: <UploadOutlined /> },
                { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
              ],
              onClick: ({ key }) => {
                if (key === 'upload') { setLogsModalOpen(true); return; }
                if (key === 'refresh') { fetchLogs(); return; }
              }
            }}
            trigger={["click"]}
          >
            <Button icon={<EllipsisOutlined />}>操作</Button>
          </Dropdown>
        </AntSpace>
      </div>
      <Table
        bordered
        rowKey={(r: any) => r.fileName}
        dataSource={logs}
        loading={logsLoading}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '文件名', dataIndex: 'fileName' },
          { title: '类型', dataIndex: 'ext' },
          { title: '大小(Byte)', dataIndex: 'sizeBytes' },
          { title: '修改时间', dataIndex: 'modifiedAt', render: (t: number) => new Date(t).toLocaleString() },
        ]}
      />

      <Modal
        title="批量上传告警日志"
        open={logsModalOpen}
        onCancel={() => { setLogsModalOpen(false); setLogsFileList([]); }}
        onOk={async () => {
          try {
            if (!logsFileList.length) { message.warning('请先选择要上传的文件'); return; }
            setLogsUploading(true);
            const files = logsFileList.map(f => f.originFileObj as File).filter(Boolean);
            const resp = await uploadSecurityLogs(files);
            if (resp?.ok) {
              message.success(`上传成功：${resp.count} 个文件`);
              setLogsModalOpen(false);
              setLogsFileList([]);
              fetchLogs();
            } else {
              message.error('上传失败');
            }
          } catch (e: any) {
            message.error(e?.response?.data?.message || e?.message || '上传失败');
          } finally {
            setLogsUploading(false);
          }
        }}
        okText={logsUploading ? '上传中...' : '上传'}
        confirmLoading={logsUploading}
        destroyOnHidden
        width={720}
      >
        <Upload.Dragger multiple accept={'.csv,.xls,.xlsx'} fileList={logsFileList} beforeUpload={() => false} onChange={({ fileList }) => setLogsFileList(fileList)}>
          <p className="ant-upload-drag-icon">
            <UploadOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传（支持 .csv/.xls/.xlsx）</p>
          <p className="ant-upload-hint">文件名示例：贵溪临港实业有限公司.csv</p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
};

export default LogsPage;