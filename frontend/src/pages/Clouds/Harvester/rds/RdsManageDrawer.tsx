import React, { useMemo } from 'react';
import {
  Drawer,
  Tabs,
  Card,
  Row,
  Col,
  Descriptions,
  Tag,
  Space,
  Button,
  Statistic,
  List,
  Table,
  Timeline,
  Typography,
  Segmented,
  message,
} from 'antd';
import {
  DatabaseOutlined,
  SafetyCertificateOutlined,
  LockOutlined,
  SyncOutlined,
} from '@ant-design/icons';

type Props = {
  open: boolean;
  onClose: () => void;
  record: any;
};

const readName = (r: any) =>
  r?.metadata?.annotations?.['tower.io/alias'] || r?.name || r?.metadata?.name || '-';

const readVmId = (r: any) => r?.metadata?.name || r?.name || '-';

const readStatus = (r: any) => {
  const vmi = r?.vmi || r?.vmiRaw;
  const migrationState = vmi?.status?.migrationState;
  const migrationAnnotation =
    vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'];
  if (migrationState) {
    const isCompleted =
      migrationState.completed === true || migrationState.Completed === true;
    if (!isCompleted) return 'Migrating';
  } else if (migrationAnnotation) {
    return 'Migrating';
  }
  if (typeof r?.status === 'string') return r.status;
  return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
};

const readNode = (r: any) =>
  r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || '-';

const readCpu = (r: any) => {
  const cpu = r?.spec?.template?.spec?.domain?.cpu;
  if (
    cpu?.sockets !== undefined &&
    cpu?.cores !== undefined &&
    cpu?.threads !== undefined
  ) {
    return Number(cpu.sockets) * Number(cpu.cores) * Number(cpu.threads);
  }
  if (cpu?.sockets !== undefined && cpu?.cores !== undefined) {
    return Number(cpu.sockets) * Number(cpu.cores) * (cpu?.threads || 1);
  }
  if (r?.cpu !== undefined && r?.cpu !== null) return Number(r.cpu);
  return (
    cpu?.cores ||
    cpu?.sockets ||
    r?.vmi?.spec?.domain?.cpu?.cores ||
    r?.spec?.template?.spec?.domain?.resources?.requests?.cpu ||
    '-'
  );
};

const readMemory = (r: any) =>
  r?.spec?.template?.spec?.domain?.memory?.guest ||
  r?.spec?.template?.spec?.domain?.resources?.limits?.memory ||
  r?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
  r?.memoryGb ||
  r?.vmi?.spec?.domain?.memory?.guest ||
  '-';

const readCreatedAt = (r: any) => {
  const t = r?.metadata?.creationTimestamp || r?.createdAt;
  return t ? new Date(t).toLocaleString() : '-';
};

const readLabels = (r: any) => r?.metadata?.labels || {};

const readImageName = (r: any) =>
  r?.spec?.template?.spec?.volumes?.find((x: any) => x?.containerDisk || x?.dataVolume)?.name ||
  r?.spec?.dataVolumeTemplates?.[0]?.spec?.sourceRef?.name ||
  '-';

const readPrimaryIp = (r: any) => {
  const interfaces = r?.status?.interfaces || r?.vmi?.status?.interfaces || [];
  const first = Array.isArray(interfaces) ? interfaces[0] : null;
  return first?.ipAddress || first?.ip || '-';
};

const readSubnet = (r: any) => {
  const networks = r?.spec?.template?.spec?.networks || [];
  const first = Array.isArray(networks) ? networks[0] : null;
  return first?.multus?.networkName || first?.name || '-';
};

const statusColorMap: Record<string, string> = {
  running: 'green',
  starting: 'blue',
  migrating: 'blue',
  stopped: 'default',
  stopping: 'orange',
  terminating: 'orange',
  error: 'red',
  errorunschedulable: 'red',
};

const chartColorMap: Record<string, string> = {
  qps: '#1677ff',
  tps: '#13c2c2',
  cpu: '#722ed1',
  delay: '#fa8c16',
};

const chartValuesMap: Record<string, number[]> = {
  qps: [26, 30, 34, 42, 50, 44, 58, 62, 70, 66, 74, 78],
  tps: [18, 22, 27, 31, 34, 30, 36, 40, 42, 39, 45, 48],
  cpu: [38, 42, 40, 46, 52, 49, 57, 60, 64, 58, 62, 66],
  delay: [10, 14, 12, 18, 16, 20, 24, 18, 22, 16, 14, 12],
};

const CardTitle: React.FC<{ title: string }> = ({ title }) => (
  <Typography.Text strong style={{ fontSize: 14 }}>
    {title}
  </Typography.Text>
);

const UnifiedCard: React.FC<{
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}> = ({ title, children, extra, style, bodyStyle }) => (
  <Card
    size="small"
    title={<CardTitle title={title} />}
    extra={extra}
    style={{ height: '100%', ...style }}
    bodyStyle={{ padding: 16, ...bodyStyle }}
  >
    {children}
  </Card>
);

const MetricChartCard: React.FC<{
  title: string;
  value: string;
  color: string;
  values: number[];
  suffix?: string;
}> = ({ title, value, color, values, suffix }) => (
  <UnifiedCard title={title}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Text type="secondary">近 1 小时</Typography.Text>
        <Typography.Text strong style={{ fontSize: 18, color }}>
          {value}
          {suffix || ''}
        </Typography.Text>
      </Space>
      <div
        style={{
          height: 88,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
          paddingTop: 8,
        }}
      >
        {values.map((item, index) => (
          <div
            key={`${title}-${index}`}
            style={{
              flex: 1,
              height: `${Math.max(18, item)}%`,
              borderRadius: 6,
              background: `linear-gradient(180deg, ${color} 0%, rgba(255,255,255,0.15) 100%)`,
              opacity: 0.9 - index * 0.02,
              minHeight: 12,
            }}
          />
        ))}
      </div>
    </Space>
  </UnifiedCard>
);

const RdsManageDrawer: React.FC<Props> = ({ open, onClose, record }) => {
  const labels = useMemo(() => readLabels(record), [record]);
  const dbType = useMemo(
    () => String(labels?.['tower.io/paas-type'] || 'mysql').toUpperCase(),
    [labels],
  );
  const dbVersion = useMemo(() => {
    const alias = readName(record);
    const raw = `${alias} ${readVmId(record)}`.toLowerCase();
    if (raw.includes('80') || raw.includes('8.0')) return '8.0';
    if (raw.includes('57') || raw.includes('5.7')) return '5.7';
    return '5.7';
  }, [record]);

  const whitelistData = useMemo(
    () => [
      { key: 'default', name: 'default', values: '10.0.0.0/24, 172.16.10.8', desc: '默认办公网段', count: 2 },
      { key: 'ecs', name: 'ecs-app', values: '192.168.10.21, 192.168.10.22', desc: '应用服务器', count: 2 },
    ],
    [],
  );

  const accountData = useMemo(
    () => [
      { key: 'root', account: 'root', scope: '管理权限', status: '启用', expiry: '永不过期' },
      { key: 'app', account: 'app_rw', scope: '读写权限', status: '启用', expiry: '90天后过期' },
      { key: 'ro', account: 'app_ro', scope: '只读权限', status: '启用', expiry: '30天后过期' },
    ],
    [],
  );

  const backupData = useMemo(
    () => [
      { key: 'b1', name: 'auto-full-2026-04-09', type: '自动全量', retain: '7天', point: '2026-04-09 02:00:00' },
      { key: 'b2', name: 'manual-before-upgrade', type: '手动备份', retain: '30天', point: '2026-04-08 20:15:00' },
    ],
    [],
  );

  const parameterData = useMemo(
    () => [
      { key: '1', name: 'max_connections', value: '2000', effect: '重启生效', category: '连接控制' },
      { key: '2', name: 'innodb_buffer_pool_size', value: '2G', effect: '动态生效', category: '缓存优化' },
      { key: '3', name: 'slow_query_log', value: 'ON', effect: '动态生效', category: '日志' },
      { key: '4', name: 'long_query_time', value: '1', effect: '动态生效', category: '慢 SQL' },
    ],
    [],
  );

  const readonlyData = useMemo(
    () => [
      { key: 'ro-1', name: `${readVmId(record)}-ro-1`, role: '只读实例', delay: '12 ms', weight: '40', zone: '可用区 B' },
      { key: 'ro-2', name: `${readVmId(record)}-ro-2`, role: '只读实例', delay: '18 ms', weight: '60', zone: '可用区 C' },
    ],
    [record],
  );

  const databaseData = useMemo(
    () => [
      { key: 'db1', name: 'app_prod', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', size: '18.4 GB' },
      { key: 'db2', name: 'audit_log', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', size: '4.6 GB' },
      { key: 'db3', name: 'reporting', charset: 'utf8mb4', collation: 'utf8mb4_bin', size: '9.1 GB' },
    ],
    [],
  );

  const privilegeData = useMemo(
    () => [
      'root 仅用于运维管理，业务账号按库授权',
      '密码 180 天轮换，首次登录强制修改',
      '应用账号、报表账号、只读账号分离',
    ],
    [],
  );

  const eventTimeline = useMemo(
    () => [
      { color: 'green', children: '14:22 实例健康检查通过，主节点运行正常' },
      { color: 'blue', children: '13:40 自动备份完成，备份集 auto-full-2026-04-09 已生成' },
      { color: 'orange', children: '12:05 检测到连接数接近阈值，已触发告警演示' },
      { color: 'red', children: '昨日 20:30 参数模板变更后待维护窗口重启生效' },
    ],
    [],
  );

  const status = String(readStatus(record));
  const statusColor = statusColorMap[status.toLowerCase()] || 'default';
  const instanceName = readName(record);
  const vmId = readVmId(record);
  const primaryIp = readPrimaryIp(record);
  const subnetName = readSubnet(record);
  const imageName = readImageName(record);

  const handleDemoAction = (action: string) => {
    message.info(`Demo：${action} 功能待接入真实后端`);
  };

  return (
    <Drawer
      title={
        <Space size={12} align="start">
          <DatabaseOutlined style={{ color: '#1677ff', fontSize: 20, marginTop: 2 }} />
          <Space direction="vertical" size={4}>
            <Typography.Text strong style={{ fontSize: 18 }}>
              {instanceName}
            </Typography.Text>
            <Space size={8} wrap>
              <Tag color={statusColor}>{status}</Tag>
              <Tag>{dbType}</Tag>
              <Tag>{`v${dbVersion}`}</Tag>
              <Tag>{vmId}</Tag>
              <Tag>{readNode(record)}</Tag>
            </Space>
          </Space>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={1320}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={() => handleDemoAction('刷新实例')}>刷新</Button>
          <Button onClick={() => handleDemoAction('重启实例')}>重启</Button>
          <Button onClick={() => handleDemoAction('主备切换')}>主备切换</Button>
          <Button type="primary" onClick={() => handleDemoAction('变更配置')}>
            变更配置
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Tabs
          destroyOnHidden
          items={[
            {
              key: 'overview',
              label: '概览',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <UnifiedCard title="实例总览">
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                        <Segmented
                          size="small"
                          options={['高可用版', '按量付费', '专有网络 VPC', '自动备份开启']}
                        />
                      </Space>
                      <Descriptions column={4} size="small">
                        <Descriptions.Item label="数据库引擎">{dbType}</Descriptions.Item>
                        <Descriptions.Item label="数据库版本">{dbVersion}</Descriptions.Item>
                        <Descriptions.Item label="镜像来源">{imageName}</Descriptions.Item>
                        <Descriptions.Item label="实例系列">高可用版</Descriptions.Item>
                        <Descriptions.Item label="网络类型">专有网络 VPC</Descriptions.Item>
                        <Descriptions.Item label="交换机 / 子网">{subnetName}</Descriptions.Item>
                        <Descriptions.Item label="内网地址">{primaryIp}</Descriptions.Item>
                        <Descriptions.Item label="计费模式">按量付费</Descriptions.Item>
                      </Descriptions>
                    </Space>
                  </UnifiedCard>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} lg={8} style={{ display: 'flex' }}>
                      <UnifiedCard title="运行状态" style={{ width: '100%' }}>
                        <Descriptions column={2} size="small">
                          <Descriptions.Item label="实例状态">
                            <Tag color={statusColor}>{status}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="节点">{readNode(record)}</Descriptions.Item>
                          <Descriptions.Item label="可维护窗口">周二 02:00 - 06:00</Descriptions.Item>
                          <Descriptions.Item label="CPU / 内存">{`${readCpu(record)}C / ${readMemory(record)}`}</Descriptions.Item>
                          <Descriptions.Item label="存储">ESSD PL1 200 GB</Descriptions.Item>
                          <Descriptions.Item label="创建时间">{readCreatedAt(record)}</Descriptions.Item>
                          <Descriptions.Item label="主可用区">华东 1 可用区 A</Descriptions.Item>
                          <Descriptions.Item label="备可用区">华东 1 可用区 B</Descriptions.Item>
                          <Descriptions.Item label="自动备份">每日 02:00</Descriptions.Item>
                        </Descriptions>
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={8} style={{ display: 'flex' }}>
                      <UnifiedCard title="访问配置" style={{ width: '100%' }}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                          <Statistic title="连接地址" value={primaryIp} valueStyle={{ fontSize: 22 }} />
                          <Descriptions column={1} size="small">
                            <Descriptions.Item label="端口">3306</Descriptions.Item>
                            <Descriptions.Item label="公网地址">demo-public.mysql.aliyun-style.local</Descriptions.Item>
                            <Descriptions.Item label="白名单分组">2 组</Descriptions.Item>
                            <Descriptions.Item label="SSL/TLS">已开启</Descriptions.Item>
                          </Descriptions>
                        </Space>
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={8} style={{ display: 'flex' }}>
                      <UnifiedCard title="高可用能力" style={{ width: '100%' }}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                          <Row gutter={[16, 16]}>
                            <Col xs={12}>
                              <Statistic title="只读实例" value={readonlyData.length} suffix="个" />
                            </Col>
                            <Col xs={12}>
                              <Statistic title="复制延迟" value="12" suffix="ms" />
                            </Col>
                          </Row>
                          <Descriptions column={1} size="small">
                            <Descriptions.Item label="主备切换">已启用</Descriptions.Item>
                            <Descriptions.Item label="数据库代理">已开启</Descriptions.Item>
                            <Descriptions.Item label="事务一致性">已开启</Descriptions.Item>
                            <Descriptions.Item label="故障恢复目标">30 秒以内</Descriptions.Item>
                          </Descriptions>
                        </Space>
                      </UnifiedCard>
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} lg={8}>
                      <UnifiedCard title="常用操作">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Button block onClick={() => handleDemoAction('新增只读实例')}>新增只读实例</Button>
                          <Button block onClick={() => handleDemoAction('编辑白名单')}>编辑白名单</Button>
                          <Button block onClick={() => handleDemoAction('立即备份')}>立即备份</Button>
                          <Button block onClick={() => handleDemoAction('创建数据库账号')}>创建数据库账号</Button>
                        </Space>
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={8}>
                      <UnifiedCard title="安全状态">
                        <List
                          size="small"
                          dataSource={[
                            'SSL/TLS：已开启',
                            'SQL 审计：已开启',
                            '透明数据加密 TDE：待启用',
                            '密码过期策略：已启用',
                          ]}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={8}>
                      <UnifiedCard title="近期事件">
                        <Timeline items={eventTimeline} />
                      </UnifiedCard>
                    </Col>
                  </Row>
                </Space>
              ),
            },
            {
              key: 'database',
              label: '数据库管理',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <UnifiedCard
                    title="数据库列表"
                    extra={<Button size="small" onClick={() => handleDemoAction('新建数据库')}>新建数据库</Button>}
                  >
                    <Table
                      size="small"
                      rowKey="key"
                      pagination={false}
                      dataSource={databaseData}
                      columns={[
                        { title: '数据库名', dataIndex: 'name' },
                        { title: '字符集', dataIndex: 'charset' },
                        { title: '排序规则', dataIndex: 'collation' },
                        { title: '数据量', dataIndex: 'size' },
                      ]}
                    />
                  </UnifiedCard>
                  <UnifiedCard
                    title="数据库账号"
                    extra={<Button size="small" onClick={() => handleDemoAction('创建数据库账号')}>创建账号</Button>}
                  >
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="key"
                      dataSource={accountData}
                      columns={[
                        { title: '账号', dataIndex: 'account' },
                        { title: '权限', dataIndex: 'scope' },
                        { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color="green">{v}</Tag> },
                      ]}
                    />
                  </UnifiedCard>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} lg={10} style={{ display: 'flex' }}>
                      <UnifiedCard
                        title="授权策略"
                        extra={<Button size="small" onClick={() => handleDemoAction('调整账号授权')}>调整授权</Button>}
                        style={{ width: '100%' }}
                      >
                        <List
                          size="small"
                          dataSource={privilegeData}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={14} style={{ display: 'flex' }}>
                      <UnifiedCard
                        title="数据迁移"
                        style={{ width: '100%' }}
                      >
                        <List
                          size="small"
                          dataSource={[
                            'DTS 上云迁移：支持全量 + 增量迁移',
                            '临时克隆实例：用于上线前校验与演练',
                            '库表级恢复：支持按库、按表快速回放',
                          ]}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                  </Row>
                </Space>
              ),
            },
            {
              key: 'security',
              label: '访问控制',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} lg={14} style={{ display: 'flex' }}>
                      <UnifiedCard
                        title="IP 白名单"
                        extra={<Button size="small" onClick={() => handleDemoAction('新增白名单分组')}>新增分组</Button>}
                        style={{ width: '100%' }}
                      >
                        <Table
                          size="small"
                          pagination={false}
                          rowKey="key"
                          dataSource={whitelistData}
                          columns={[
                            { title: '分组名', dataIndex: 'name' },
                            { title: 'IP / IP段', dataIndex: 'values' },
                            { title: '数量', dataIndex: 'count' },
                            { title: '描述', dataIndex: 'desc' },
                          ]}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={10} style={{ display: 'flex' }}>
                      <UnifiedCard title="连接信息" style={{ width: '100%' }}>
                        <Descriptions column={1} size="small">
                          <Descriptions.Item label="内网地址">{primaryIp}</Descriptions.Item>
                          <Descriptions.Item label="公网地址">demo-public.mysql.aliyun-style.local</Descriptions.Item>
                          <Descriptions.Item label="端口">3306</Descriptions.Item>
                          <Descriptions.Item label="VPC / 子网">{`vpc-prod-main / ${subnetName}`}</Descriptions.Item>
                        </Descriptions>
                      </UnifiedCard>
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} md={8} style={{ display: 'flex' }}>
                      <UnifiedCard title="SSL / TLS" extra={<LockOutlined />} style={{ width: '100%' }}>
                        <List
                          size="small"
                          dataSource={['SSL/TLS：已开启', '服务端证书：可下载', '连接加密强制：已启用']}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} md={8} style={{ display: 'flex' }}>
                      <UnifiedCard title="数据加密" extra={<SafetyCertificateOutlined />} style={{ width: '100%' }}>
                        <List
                          size="small"
                          dataSource={['TDE：未开启', 'KMS 密钥：kms-demo-key', '支持透明数据加密演示']}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} md={8} style={{ display: 'flex' }}>
                      <UnifiedCard title="审计日志" extra={<SyncOutlined />} style={{ width: '100%' }}>
                        <List
                          size="small"
                          dataSource={['SQL 审计：已开启', '保留天数：180 天', '支持导出 / 检索 / 下载']}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                  </Row>
                </Space>
              ),
            },
            {
              key: 'backup',
              label: '备份恢复',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <UnifiedCard
                    title="备份策略"
                    extra={
                      <Space>
                        <Button size="small" onClick={() => handleDemoAction('修改备份策略')}>修改策略</Button>
                        <Button size="small" type="primary" onClick={() => handleDemoAction('立即手动备份')}>手动备份</Button>
                      </Space>
                    }
                  >
                    <Descriptions column={3} size="small">
                      <Descriptions.Item label="全量备份周期">每天</Descriptions.Item>
                      <Descriptions.Item label="备份时间">02:00 - 03:00</Descriptions.Item>
                      <Descriptions.Item label="保留天数">30 天</Descriptions.Item>
                      <Descriptions.Item label="PITR">已开启</Descriptions.Item>
                      <Descriptions.Item label="跨地域备份">已开启</Descriptions.Item>
                      <Descriptions.Item label="库表恢复">支持</Descriptions.Item>
                    </Descriptions>
                  </UnifiedCard>
                  <UnifiedCard title="备份集列表">
                    <Table
                      size="small"
                      rowKey="key"
                      pagination={false}
                      dataSource={backupData}
                      columns={[
                        { title: '备份名称', dataIndex: 'name' },
                        { title: '备份类型', dataIndex: 'type' },
                        { title: '恢复点', dataIndex: 'point' },
                        { title: '保留策略', dataIndex: 'retain' },
                        {
                          title: '操作',
                          key: 'action',
                          render: () => (
                            <Space size={8}>
                              <Button size="small" onClick={() => handleDemoAction('按时间点恢复')}>时间点恢复</Button>
                              <Button size="small" onClick={() => handleDemoAction('按备份集恢复')}>恢复</Button>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </UnifiedCard>
                </Space>
              ),
            },
            {
              key: 'performance',
              label: '参数调优',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} lg={14} style={{ display: 'flex' }}>
                      <UnifiedCard
                        title="运行参数"
                        extra={
                          <Space>
                            <Button size="small" onClick={() => handleDemoAction('应用参数模板')}>应用模板</Button>
                            <Button size="small" type="primary" onClick={() => handleDemoAction('修改参数')}>修改参数</Button>
                          </Space>
                        }
                        style={{ width: '100%' }}
                      >
                        <Table
                          size="small"
                          rowKey="key"
                          pagination={false}
                          dataSource={parameterData}
                          columns={[
                            { title: '参数名', dataIndex: 'name' },
                            { title: '当前值', dataIndex: 'value' },
                            { title: '分类', dataIndex: 'category' },
                            { title: '生效方式', dataIndex: 'effect' },
                          ]}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={10} style={{ display: 'flex' }}>
                      <UnifiedCard title="性能诊断入口" style={{ width: '100%' }}>
                        <List
                          size="small"
                          dataSource={[
                            '慢 SQL 分析',
                            '错误日志 / 运行日志',
                            '性能洞察',
                            '锁等待 / 死锁分析',
                            '自治优化建议',
                          ]}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                  </Row>
                  <UnifiedCard title="关键优化建议">
                    <List
                      size="small"
                      dataSource={[
                        'max_connections：根据连接池规模调优，避免连接打满',
                        'innodb_buffer_pool_size：建议设置为内存的 50%~70%',
                        'slow_query_log：建议保持开启，便于慢 SQL 诊断',
                        'long_query_time：线上环境可逐步收敛到 1 秒以内',
                      ]}
                      renderItem={(item) => <List.Item>{item}</List.Item>}
                    />
                  </UnifiedCard>
                </Space>
              ),
            },
            {
              key: 'ha',
              label: '高可用',
              children: (
                <Row gutter={[16, 16]} align="stretch">
                  <Col xs={24} lg={10} style={{ display: 'flex' }}>
                    <UnifiedCard title="高可用架构" style={{ width: '100%' }}>
                      <List
                        size="small"
                        dataSource={[
                          '主实例：可用区 A',
                          '备实例：可用区 B',
                          '自动故障切换：已开启',
                          '主备复制方式：半同步复制',
                          '故障恢复目标：30 秒以内',
                        ]}
                        renderItem={(item) => <List.Item>{item}</List.Item>}
                      />
                    </UnifiedCard>
                  </Col>
                  <Col xs={24} lg={14} style={{ display: 'flex' }}>
                    <UnifiedCard
                      title="只读实例"
                      extra={<Button size="small" onClick={() => handleDemoAction('配置读写分离代理')}>配置代理</Button>}
                      style={{ width: '100%' }}
                    >
                      <Table
                        size="small"
                        rowKey="key"
                        pagination={false}
                        dataSource={readonlyData}
                        columns={[
                          { title: '节点名称', dataIndex: 'name' },
                          { title: '角色', dataIndex: 'role' },
                          { title: '部署区域', dataIndex: 'zone' },
                          { title: '复制延迟', dataIndex: 'delay' },
                          { title: '读流量权重', dataIndex: 'weight' },
                        ]}
                      />
                    </UnifiedCard>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'monitor',
              label: '监控告警',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={6}>
                      <MetricChartCard title="QPS" value="1280" color={chartColorMap.qps} values={chartValuesMap.qps} suffix="/s" />
                    </Col>
                    <Col xs={24} md={6}>
                      <MetricChartCard title="TPS" value="920" color={chartColorMap.tps} values={chartValuesMap.tps} suffix="/s" />
                    </Col>
                    <Col xs={24} md={6}>
                      <MetricChartCard title="CPU 使用率" value="66" color={chartColorMap.cpu} values={chartValuesMap.cpu} suffix="%" />
                    </Col>
                    <Col xs={24} md={6}>
                      <MetricChartCard title="主备延迟" value="12" color={chartColorMap.delay} values={chartValuesMap.delay} suffix="ms" />
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]} align="stretch">
                    <Col xs={24} lg={12} style={{ display: 'flex' }}>
                      <UnifiedCard title="核心监控指标" style={{ width: '100%' }}>
                        <List
                          size="small"
                          dataSource={[
                            '连接数：436 / 2000',
                            'InnoDB 缓存命中率：99.2%',
                            '慢 SQL 数量：17',
                            '磁盘 IOPS：1450',
                            '存储空间使用率：62%',
                          ]}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                    <Col xs={24} lg={12} style={{ display: 'flex' }}>
                      <UnifiedCard title="告警策略" style={{ width: '100%' }}>
                        <List
                          size="small"
                          dataSource={[
                            'CPU > 80% 持续 5 分钟：短信 + 钉钉',
                            '连接数 > 1500：邮件',
                            '存储空间使用率 > 85%：电话 + 短信',
                            '只读延迟 > 200 ms：钉钉',
                          ]}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </UnifiedCard>
                    </Col>
                  </Row>
                </Space>
              ),
            },
          ]}
        />

      </Space>
    </Drawer>
  );
};

export default RdsManageDrawer;
