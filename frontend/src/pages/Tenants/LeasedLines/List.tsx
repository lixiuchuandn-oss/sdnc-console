import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Select, Table, Tag, Modal, Row, Col, message, Dropdown, DatePicker } from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined, UploadOutlined, ReloadOutlined, EllipsisOutlined, FileWordOutlined, FilePdfOutlined, FileOutlined, DeleteOutlined, UndoOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listLeasedLines, createLeasedLine, updateLeasedLine, deleteLeasedLine, startSecurityReportTask, batchDeleteLeasedLines } from '../../../services/leasedLineApi';
import type { TenantLeasedLine } from '../../../types/leasedLine';
import '../../common/filters.css';
import { provinces, cityOptionsByProvince, operators } from './constants';
import ImportModal from './ImportModal';

type Props = {
  onStartTask?: (taskId: string) => void;
};


const ListPage: React.FC<Props> = ({ onStartTask }) => {
  const [filterForm] = Form.useForm();
  const [list, setList] = useState<TenantLeasedLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [provinceFilter, setProvinceFilter] = useState<string | undefined>(undefined);
  const [cityFilter, setCityFilter] = useState<string | undefined>(undefined);
  const [operatorFilter, setOperatorFilter] = useState<string | undefined>(undefined);
  const [logRange, setLogRange] = useState<any[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm] = Form.useForm();

  const [importModalOpen, setImportModalOpen] = useState(false);

  const datasetCitiesByProvince = useMemo(() => {
    const map = new Map<string, Set<string>>();
    (list || []).forEach(item => {
      const p = item.province || '';
      const c = item.city || '';
      if (!map.has(p)) map.set(p, new Set<string>());
      if (c) map.get(p)!.add(c);
    });
    return map;
  }, [list]);

  const filterCityOptions = useMemo(() => {
    const p = provinceFilter || '';
    const fromDict = cityOptionsByProvince[p] || [];
    const fromData = Array.from(datasetCitiesByProvince.get(p) || new Set<string>());
    const merged = Array.from(new Set([...(fromDict || []), ...(fromData || [])]));
    return merged.map(c => ({ value: c, label: c }));
  }, [provinceFilter, datasetCitiesByProvince]);

  const createProvince = Form.useWatch('province', createForm);

  const createCityOptions = useMemo(() => {
    const p = createProvince;
    const dict = cityOptionsByProvince[p] || [];
    const data = Array.from(datasetCitiesByProvince.get(p || '') || new Set<string>());
    const merged = Array.from(new Set([...(dict || []), ...(data || [])]));
    return merged.map(c => ({ value: c, label: c }));
  }, [createProvince, datasetCitiesByProvince]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const data = await listLeasedLines(keyword || undefined);
      setList(data);
    } catch (e: any) {
      message.error('获取租户专线列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  const filteredList = useMemo(() => {
    const matchLogTime = (ts?: number) => {
      if (!Array.isArray(logRange) || logRange.length !== 2 || !logRange[0] || !logRange[1]) return true;
      const start = Number((logRange[0] as any).valueOf?.() ?? logRange[0]);
      const end = Number((logRange[1] as any).valueOf?.() ?? logRange[1]);
      const t = Number(ts || 0);
      return t >= start && t <= end;
    };
    return list.filter(item => {
      const matchProvince = provinceFilter ? item.province === provinceFilter : true;
      const matchCity = cityFilter ? item.city === cityFilter : true;
      const matchOp = operatorFilter ? item.operator === operatorFilter : true;
      const matchKeyword = keyword
        ? [item.tenantName, item.region, item.province, item.city, item.operator, item.ips].some(v => String(v).toLowerCase().includes(keyword.toLowerCase()))
        : true;
      const matchTime = matchLogTime(item.logModifiedAt);
      return matchProvince && matchCity && matchOp && matchKeyword && matchTime;
    });
  }, [list, provinceFilter, cityFilter, operatorFilter, keyword, logRange]);

  const getActionMenu = (row: TenantLeasedLine): MenuProps['items'] => ([
    { key: 'edit', label: '编辑', icon: <EditOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
    { type: 'divider' },
    { key: 'genReport', label: '生成安全报告', icon: <FileWordOutlined /> },
  ]);

  const handleRowActionClick = (row: TenantLeasedLine): MenuProps['onClick'] => ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'edit') {
      setCreateModalOpen(true);
      createForm.setFieldsValue({ tenantName: row.tenantName, province: row.province, city: row.city, operator: row.operator, ips: row.ips });
      (createForm as any).__editId = row.id;
    } else if (key === 'delete') {
      Modal.confirm({
        title: '确认删除专线记录',
        content: '删除后无法恢复，确定删除该专线？',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          await deleteLeasedLine(row.id);
          message.success('已删除');
          fetchList();
        },
      });
    } else if (key === 'genReport') {
      const tryGen = async () => {
        try {
          const start = await startSecurityReportTask(row.id);
          if (!start?.taskId) { message.error('创建任务失败'); return; }
          message.success('任务已创建，请在“租户安全报告任务列表”查看进度');
          if (onStartTask) onStartTask(start.taskId);
        } catch (e: any) {
          const msg = e?.response?.data?.message || e?.message || e;
          if (e?.response?.status === 409) {
            message.info('该租户已有进行中的任务，请在列表查看进度');
          } else {
            message.error(`创建任务失败：${msg}`);
          }
        }
      };
      tryGen();
    }
  };

  const columns: ColumnsType<TenantLeasedLine> = [
    { title: '租户名称', dataIndex: 'tenantName', key: 'tenantName', sorter: (a, b) => String(a.tenantName).localeCompare(String(b.tenantName)), sortDirections: ['ascend','descend'] },
    { title: '地域', dataIndex: 'region', key: 'region', render: (_: any, r: TenantLeasedLine) => <Tag color="blue">{`${r.province}/${r.city}`}</Tag>, sorter: (a, b) => (String(a.province).localeCompare(String(b.province)) || String(a.city).localeCompare(String(b.city))), sortDirections: ['ascend','descend'] },
    { title: '运营商', dataIndex: 'operator', key: 'operator', render: (v: string) => <Tag color="geekblue">{v}</Tag>, sorter: (a, b) => String(a.operator).localeCompare(String(b.operator)), sortDirections: ['ascend','descend'] },
    { title: '专线IP', dataIndex: 'ips', key: 'ips', width: 200, ellipsis: true, render: (v: string) => <span title={v}>{v}</span>, sorter: (a, b) => String(a.ips || '').localeCompare(String(b.ips || '')), sortDirections: ['ascend','descend'] },
    { title: '告警日志', dataIndex: 'hasLog', key: 'hasLog', render: (_: any, r: TenantLeasedLine) => r.hasLog ? <Tag color="green">已上传</Tag> : <Tag color="red">未上传</Tag>, sorter: (a, b) => Number(!!a.hasLog) - Number(!!b.hasLog), sortDirections: ['ascend','descend'] },
    { title: '日志文件', key: 'logFileInfo', render: (_: any, r: TenantLeasedLine) => {
      if (!r.logFileName) return '-';
      const name = String(r.logFileName).trim();
      const size = Number(r.logFileSize || 0);
      const ext = name.split('.').pop()?.toLowerCase();
      const formatSize = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
           {ext === 'pdf' ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : 
            (ext === 'doc' || ext === 'docx') ? <FileWordOutlined style={{ color: '#1677ff' }} /> : 
            <FileOutlined />}
           <span style={{ fontSize: 13 }}>{name}</span>
           {size > 0 ? <span style={{ color: '#999', fontSize: 12 }}>{formatSize(size)}</span> : null}
        </div>
      );
    }, sorter: (a, b) => String(a.logFileName || '').localeCompare(String(b.logFileName || '')), sortDirections: ['ascend','descend'] },
    { title: '修改时间', dataIndex: 'logModifiedAt', key: 'logModifiedAt', render: (t?: number) => (typeof t === 'number' && t > 0) ? new Date(t).toLocaleString() : '-', sorter: (a, b) => Number(a.logModifiedAt || 0) - Number(b.logModifiedAt || 0), sortDirections: ['ascend','descend'] },
    { title: '操作', key: 'actions', fixed: 'right', width: 120, render: (_: any, r: TenantLeasedLine) => (
      <Dropdown menu={{ items: getActionMenu(r), onClick: handleRowActionClick(r) }} trigger={["click"]}>
        <Button type="text" icon={<EllipsisOutlined />} />
      </Dropdown>
    ) }
  ];

  const handleCreateSubmit = async () => {
    try {
      const values = await createForm.validateFields();
      const payload = {
        tenantName: String(values.tenantName).trim(),
        province: String(values.province).trim(),
        city: Array.isArray(values.city) ? String(values.city[0]).trim() : String(values.city).trim(),
        operator: String(values.operator).trim(),
        ips: String(values.ips).split(/[\s,;]+/).map((s: string) => s.trim()).filter(Boolean),
      };
      setCreateSubmitting(true);
      const editId = (createForm as any).__editId as string | undefined;
      if (editId) {
        await updateLeasedLine(editId, payload);
        message.success('更新成功');
      } else {
        await createLeasedLine(payload);
        message.success('创建成功');
      }
      setCreateModalOpen(false);
      (createForm as any).__editId = undefined;
      createForm.resetFields();
      fetchList();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '提交失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <>
      <div className="filters-row">
        <Form
          className="filter-tools"
          form={filterForm}
          layout="inline"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setProvinceFilter(all.province || undefined);
            const c = all.city;
            setCityFilter(Array.isArray(c) ? (c[0] || undefined) : (c || undefined));
            setOperatorFilter(all.operator || undefined);
            const r = all.logRange;
            setLogRange(Array.isArray(r) ? r : []);
          }}
        >
          <Form.Item name="keyword" label="筛选">
            <Input allowClear placeholder="搜索租户/地域/运营商/IP" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="logRange" label="告警日志时间">
            <DatePicker.RangePicker />
          </Form.Item>
          <Form.Item name="province" label="省">
            <Select allowClear showSearch placeholder="选择省" style={{ width: 140 }} options={provinces.map(p => ({ value: p, label: p }))} />
          </Form.Item>
          <Form.Item name="city" label="市">
            <Select
              allowClear
              showSearch
              mode="tags"
              optionFilterProp="label"
              placeholder="选择或输入城市"
              style={{ width: 180 }}
              tokenSeparators={[',','，','/',' ']}
              options={filterCityOptions}
            />
          </Form.Item>
          <Form.Item name="operator" label="运营商">
            <Select allowClear placeholder="选择运营商" style={{ width: 140 }} options={operators.map(o => ({ value: o, label: o }))} />
          </Form.Item>
          <Form.Item>
            <Button type="link" size="small" icon={<UndoOutlined />} style={{ marginLeft: 0, paddingLeft: 0 }} onClick={() => { filterForm.resetFields(); setKeyword(''); setProvinceFilter(undefined); setCityFilter(undefined); setOperatorFilter(undefined); setLogRange([]); }}>重置</Button>
          </Form.Item>
        </Form>
        <div className="filter-actions">
          <Dropdown
            menu={{
              items: [
                { key: 'create', label: '新增专线', icon: <PlusOutlined /> },
                { key: 'import', label: 'CSV 导入', icon: <UploadOutlined /> },
                { type: 'divider' },
                { key: 'batchDelete', label: `批量删除${selectedRowKeys.length?`(${selectedRowKeys.length})`:''}`, icon: <DeleteOutlined />, disabled: !selectedRowKeys.length },
                { key: 'batchReport', label: `批量生成安全报告${selectedRowKeys.length?`(${selectedRowKeys.length})`:''}`, icon: <FileWordOutlined />, disabled: !selectedRowKeys.length },
                { type: 'divider' },
                { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
              ],
              onClick: async ({ key }) => {
                if (key === 'create') { setCreateModalOpen(true); return; }
                if (key === 'import') { setImportModalOpen(true); return; }
                if (key === 'refresh') { fetchList(); return; }
                if (key === 'batchDelete') {
                  Modal.confirm({
                    title: '确认批量删除所选专线',
                    content: `将删除 ${selectedRowKeys.length} 条记录，删除后无法恢复。是否继续？`,
                    okText: '批量删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: async () => {
                      try {
                        const resp = await batchDeleteLeasedLines(selectedRowKeys);
                        const n = Number(resp?.deleted || 0);
                        if (n) { message.success(`已删除 ${n} 条记录`); } else { message.info('未删除任何记录'); }
                        setSelectedRowKeys([]);
                        fetchList();
                      } catch (e: any) {
                        const msg = e?.response?.data?.message || e?.message || '批量删除失败';
                        message.error(msg);
                      }
                    }
                  });
                  return;
                }
                if (key === 'batchReport') {
                  try {
                    let created = 0; let skipped = 0; let conflicts = 0;
                    let firstTaskId: string | undefined = undefined;
                    for (const id of selectedRowKeys) {
                      try {
                        const resp = await startSecurityReportTask(id);
                        if (resp?.taskId) {
                          created++;
                          if (!firstTaskId) firstTaskId = resp.taskId;
                        } else {
                          skipped++;
                        }
                        await new Promise(r=>setTimeout(r,200));
                      } catch (e: any) {
                        if (e?.response?.status === 409) { conflicts++; } else { skipped++; }
                      }
                    }
                    if (created) message.success(`已创建 ${created} 个任务`);
                    if (conflicts) message.info(`已有进行中的任务：${conflicts} 个`);
                    if (skipped) message.warning(`创建失败或跳过：${skipped} 个`);
                    if (firstTaskId && onStartTask) onStartTask(firstTaskId);
                  } catch {}
                  return;
                }
              }
            }}
            trigger={["click"]}
          >
            <Button icon={<EllipsisOutlined />}>操作</Button>
          </Dropdown>
        </div>
      </div>

      <Table
        className="vr-table"
        bordered
        columns={columns}
        dataSource={filteredList}
        rowKey="id"
        rowSelection={{ selectedRowKeys, onChange: (keys)=> setSelectedRowKeys(keys as string[]) }}
        pagination={{ pageSize: 10 }}
        loading={loading}
      />

      <Modal
        title={(createForm as any).__editId ? '编辑专线' : '新增专线'}
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); (createForm as any).__editId = undefined; createForm.resetFields(); }}
        onOk={handleCreateSubmit}
        okText={createSubmitting ? '提交中...' : '提交'}
        confirmLoading={createSubmitting}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="tenantName" label="租户名称" rules={[{ required: true, message: '请输入租户名称' }]}>
                <Input placeholder="公司名称（自动关联/创建租户）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="province" label="省" rules={[{ required: true, message: '请选择省' }]}> 
                <Select showSearch placeholder="选择省" options={provinces.map(r => ({ value: r, label: r }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="city" label="市" rules={[{ required: true, message: '请选择市' }]}> 
                <Select 
                  showSearch 
                  mode="tags"
                  optionFilterProp="label"
                  placeholder="选择或输入城市" 
                  tokenSeparators={[',','，','/',' ']}
                  options={createCityOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="operator" label="运营商" rules={[{ required: true, message: '请选择运营商' }]}> 
                <Select placeholder="选择运营商" options={operators.map(o => ({ value: o, label: o }))} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="ips" label="专线IP" rules={[{ required: true, message: '请输入专线IP' }]} extra="可输入多个IP，使用逗号/空格分隔">
                <Input.TextArea rows={3} placeholder="如 115.153.156.247,115.153.156.248,115.153.156.249" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <ImportModal
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onSuccess={() => { setImportModalOpen(false); fetchList(); }}
        datasetCitiesByProvince={datasetCitiesByProvince}
      />
    </>
  );
};

export default ListPage;