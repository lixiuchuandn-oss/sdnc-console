import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tabs, Modal, Form, Typography, InputNumber } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import {
  fetchCloudProviderRdsAccounts, createCloudProviderRdsAccount, deleteCloudProviderRdsAccount, resetCloudProviderRdsAccountPassword,
  fetchCloudProviderRdsDatabases, createCloudProviderRdsDatabase, deleteCloudProviderRdsDatabase,
  fetchCloudProviderRdsWhitelist, modifyCloudProviderRdsWhitelist,
  modifyCloudProviderRdsSpec,
  fetchCloudProviderRdsBackups, createCloudProviderRdsBackup,
  fetchCloudProviderRdsNetInfo, allocateCloudProviderRdsPublicConnection,
} from '../../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  rds: any | null;
  onClose: () => void;
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const RdsDetailDrawerAliyun: React.FC<Props> = ({ open, cloudId, rds, onClose }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [databases, setDatabases] = useState<any[]>([]);
  const [whitelist, setWhitelist] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [netInfo, setNetInfo] = useState<any[]>([]);
  const [acctForm] = Form.useForm();
  const [dbForm] = Form.useForm();
  const [wlForm] = Form.useForm();
  const [specForm] = Form.useForm();
  const [pubForm] = Form.useForm();
  const [acctOpen, setAcctOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);

  const dbId = rds?.DBInstanceId;

  const load = useCallback(async () => {
    if (!cloudId || !dbId) return;
    setLoading(true);
    try {
      const [a, d, w, b, n]: any[] = await Promise.all([
        fetchCloudProviderRdsAccounts(cloudId, dbId).catch(() => null),
        fetchCloudProviderRdsDatabases(cloudId, dbId).catch(() => null),
        fetchCloudProviderRdsWhitelist(cloudId, dbId).catch(() => null),
        fetchCloudProviderRdsBackups(cloudId, dbId).catch(() => null),
        fetchCloudProviderRdsNetInfo(cloudId, dbId).catch(() => null),
      ]);
      setAccounts(ensureArr((a?.data?.Accounts?.DBInstanceAccount) || (a?.Accounts?.DBInstanceAccount)));
      setDatabases(ensureArr((d?.data?.Databases?.Database) || (d?.Databases?.Database)));
      setWhitelist(ensureArr((w?.data?.Items?.DBInstanceIPArray) || (w?.Items?.DBInstanceIPArray)));
      setBackups(ensureArr((b?.data?.Items?.Backup) || (b?.Items?.Backup)));
      setNetInfo(ensureArr((n?.data?.DBInstanceNetInfos?.DBInstanceNetInfo) || (n?.DBInstanceNetInfos?.DBInstanceNetInfo)));
    } catch (e: any) {
      message.error(e?.message || '查询详情失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, dbId, message]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setSubmitting(true);
    try { await fn(); message.success(ok); await load(); return true; }
    catch (e: any) { message.error(e?.message || '操作失败'); return false; }
    finally { setSubmitting(false); }
  };

  const submitAcct = async () => {
    try { const v = await acctForm.validateFields(); if (await run(() => createCloudProviderRdsAccount(cloudId, dbId, v), '创建成功')) setAcctOpen(false); }
    catch (e: any) { if (!e?.errorFields) message.error(e?.message || '创建失败'); }
  };
  const submitDb = async () => {
    try { const v = await dbForm.validateFields(); if (await run(() => createCloudProviderRdsDatabase(cloudId, dbId, v), '创建成功')) setDbOpen(false); }
    catch (e: any) { if (!e?.errorFields) message.error(e?.message || '创建失败'); }
  };
  const submitSpec = async () => {
    try { const v = await specForm.validateFields(); if (await run(() => modifyCloudProviderRdsSpec(cloudId, dbId, v), '变配指令已下发')) setSpecOpen(false); }
    catch (e: any) { if (!e?.errorFields) message.error(e?.message || '变配失败'); }
  };
  const submitPub = async () => {
    try { const v = await pubForm.validateFields(); if (await run(() => allocateCloudProviderRdsPublicConnection(cloudId, dbId, v), '申请成功')) setPubOpen(false); }
    catch (e: any) { if (!e?.errorFields) message.error(e?.message || '申请失败'); }
  };

  const resetAcctPwd = (acct: any) => {
    let pwd = '';
    Modal.confirm({
      title: `重置账号 ${acct?.AccountName} 密码`,
      content: (<Input.Password placeholder="输入新密码(8-32位)" onChange={(e) => { pwd = e.target.value; }} />),
      okText: '确认', cancelText: '取消',
      onOk: async () => { if (!pwd) { message.error('请输入新密码'); throw new Error('empty'); } await run(() => resetCloudProviderRdsAccountPassword(cloudId, dbId, acct?.AccountName, pwd), '重置成功'); },
    });
  };
  const delAcct = (acct: any) => Modal.confirm({ title: '删除账号?', content: acct?.AccountName, okType: 'danger', okText: '删除', cancelText: '取消', onOk: () => run(() => deleteCloudProviderRdsAccount(cloudId, dbId, acct?.AccountName), '删除成功') });
  const delDb = (db: any) => Modal.confirm({ title: '删除数据库?', content: db?.DBName, okType: 'danger', okText: '删除', cancelText: '取消', onOk: () => run(() => deleteCloudProviderRdsDatabase(cloudId, dbId, db?.DBName), '删除成功') });

  const editWhitelist = (group: any) => {
    wlForm.resetFields();
    wlForm.setFieldsValue({ groupName: group?.DBInstanceIPArrayName || 'default', securityIps: group?.SecurityIPList || '' });
    Modal.confirm({
      title: `修改白名单分组 ${group?.DBInstanceIPArrayName || 'default'}`,
      content: (
        <Form form={wlForm} layout="vertical">
          <Form.Item name="groupName" label="分组名"><Input disabled /></Form.Item>
          <Form.Item name="securityIps" label="白名单 IP（逗号分隔）" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      ),
      okText: '保存', cancelText: '取消',
      onOk: async () => { const v = await wlForm.validateFields(); await run(() => modifyCloudProviderRdsWhitelist(cloudId, dbId, v), '修改成功'); },
    });
  };

  const tabs = useMemo(() => ([
    {
      key: 'accounts', label: `账号（${accounts.length}）`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { acctForm.resetFields(); setAcctOpen(true); }}>创建账号</Button></Space>
          <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.AccountName} dataSource={accounts} pagination={false} scroll={{ x: true }}
            columns={[
              { title: '账号', dataIndex: 'AccountName', key: 'name' },
              { title: '类型', dataIndex: 'AccountType', key: 'type', render: (v: any) => (v === 'Super' ? '高权限' : '普通') },
              { title: '状态', dataIndex: 'AccountStatus', key: 'status' },
              { title: '描述', dataIndex: 'AccountDescription', key: 'desc', render: (v: any) => v || '-' },
              { title: '操作', key: 'op', width: 160, render: (_: any, r: any) => (<Space size={4}><Button size="small" type="link" onClick={() => resetAcctPwd(r)}>重置密码</Button><Button size="small" type="link" danger onClick={() => delAcct(r)}>删除</Button></Space>) },
            ] as any} />
        </Space>
      ),
    },
    {
      key: 'databases', label: `数据库（${databases.length}）`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { dbForm.resetFields(); dbForm.setFieldsValue({ characterSetName: 'utf8' }); setDbOpen(true); }}>创建数据库</Button></Space>
          <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.DBName} dataSource={databases} pagination={false} scroll={{ x: true }}
            columns={[
              { title: '数据库', dataIndex: 'DBName', key: 'name' },
              { title: '字符集', dataIndex: 'CharacterSetName', key: 'charset' },
              { title: '状态', dataIndex: 'DBStatus', key: 'status' },
              { title: '描述', dataIndex: 'DBDescription', key: 'desc', render: (v: any) => v || '-' },
              { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => delDb(r)}>删除</Button> },
            ] as any} />
        </Space>
      ),
    },
    {
      key: 'whitelist', label: `白名单（${whitelist.length}）`,
      children: (
        <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.DBInstanceIPArrayName} dataSource={whitelist} pagination={false} scroll={{ x: true }}
          columns={[
            { title: '分组', dataIndex: 'DBInstanceIPArrayName', key: 'name' },
            { title: '白名单 IP', dataIndex: 'SecurityIPList', key: 'ips', render: (v: any) => <Typography.Text copyable={{ text: v }} style={{ maxWidth: 380 }} ellipsis={{ tooltip: v }}>{v}</Typography.Text> },
            { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" onClick={() => editWhitelist(r)}>编辑</Button> },
          ] as any} />
      ),
    },
    {
      key: 'backups', label: `备份（${backups.length}）`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => run(() => createCloudProviderRdsBackup(cloudId, dbId), '备份指令已下发')}>立即备份</Button></Space>
          <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.BackupId} dataSource={backups} pagination={false} scroll={{ x: true }}
            columns={[
              { title: '备份 ID', dataIndex: 'BackupId', key: 'id' },
              { title: '类型', dataIndex: 'BackupType', key: 'type', render: (v: any) => (v === 'F' ? '全量' : v === 'I' ? '增量' : v) },
              { title: '模式', dataIndex: 'BackupMode', key: 'mode' },
              { title: '状态', dataIndex: 'BackupStatus', key: 'status' },
              { title: '开始时间', dataIndex: 'BackupStartTime', key: 'time' },
            ] as any} />
        </Space>
      ),
    },
    {
      key: 'net', label: `连接地址（${netInfo.length}）`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { pubForm.resetFields(); pubForm.setFieldsValue({ port: 3306 }); setPubOpen(true); }}>申请外网地址</Button></Space>
          <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any, i) => r?.ConnectionString || String(i)} dataSource={netInfo} pagination={false} scroll={{ x: true }}
            columns={[
              { title: '连接地址', dataIndex: 'ConnectionString', key: 'cs', render: (v: any) => <Typography.Text copyable={{ text: v }}>{v}</Typography.Text> },
              { title: '类型', dataIndex: 'IPType', key: 'type', render: (v: any) => (v === 'Public' ? '外网' : v === 'Private' ? '内网' : v) },
              { title: '端口', dataIndex: 'Port', key: 'port' },
              { title: 'IP', dataIndex: 'IPAddress', key: 'ip' },
            ] as any} />
        </Space>
      ),
    },
  ]), [accounts, databases, whitelist, backups, netInfo, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <StdSideDrawer open={open} onClose={onClose} width={980} title={`数据库管理 · ${rds?.DBInstanceDescription || dbId || ''}`}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Button onClick={() => { specForm.resetFields(); setSpecOpen(true); }}>变更规格</Button>
      </Space>
      <Tabs items={tabs} />

      <Modal title="创建账号" open={acctOpen} onCancel={() => setAcctOpen(false)} onOk={submitAcct} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={acctForm} layout="vertical">
          <Form.Item name="accountName" label="账号名" rules={[{ required: true, message: '请输入账号名' }]}><Input allowClear /></Form.Item>
          <Form.Item name="accountPassword" label="密码" rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}><Input.Password /></Form.Item>
          <Form.Item name="accountType" label="账号类型" initialValue="Normal"><Select options={[{ label: '普通账号', value: 'Normal' }, { label: '高权限账号', value: 'Super' }]} /></Form.Item>
          <Form.Item name="accountDescription" label="描述"><Input allowClear /></Form.Item>
        </Form>
      </Modal>

      <Modal title="创建数据库" open={dbOpen} onCancel={() => setDbOpen(false)} onOk={submitDb} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={dbForm} layout="vertical">
          <Form.Item name="dbName" label="数据库名" rules={[{ required: true, message: '请输入数据库名' }]}><Input allowClear /></Form.Item>
          <Form.Item name="characterSetName" label="字符集"><Select options={['utf8', 'utf8mb4', 'gbk', 'latin1'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item name="dbDescription" label="描述"><Input allowClear /></Form.Item>
        </Form>
      </Modal>

      <Modal title="变更规格" open={specOpen} onCancel={() => setSpecOpen(false)} onOk={submitSpec} confirmLoading={submitting} okText="确认变配" cancelText="取消" destroyOnClose>
        <Form form={specForm} layout="vertical">
          <Typography.Paragraph type="secondary">当前规格：{rds?.DBInstanceClass || '-'}，存储：{rds?.DBInstanceStorage ?? '-'} GB</Typography.Paragraph>
          <Form.Item name="dbInstanceClass" label="目标规格" extra="留空则不改规格"><Input placeholder="如 mysql.n2.medium.1" allowClear /></Form.Item>
          <Form.Item name="dbInstanceStorage" label="目标存储 (GB)" extra="留空则不改存储"><InputNumber min={5} max={6000} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="申请外网连接地址" open={pubOpen} onCancel={() => setPubOpen(false)} onOk={submitPub} confirmLoading={submitting} okText="申请" cancelText="取消" destroyOnClose>
        <Form form={pubForm} layout="vertical">
          <Form.Item name="connectionStringPrefix" label="连接地址前缀" rules={[{ required: true, message: '请输入前缀' }]} extra="将生成 <前缀>.mysql.rds.aliyuncs.com"><Input placeholder="如 mydb-public" allowClear /></Form.Item>
          <Form.Item name="port" label="端口"><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </StdSideDrawer>
  );
};

export default RdsDetailDrawerAliyun;
