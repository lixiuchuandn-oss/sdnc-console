import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress, Space as AntSpace, Table, Tag, Modal, Timeline, Popover, message, Dropdown, Form, Input, DatePicker, Select, Tabs, Descriptions, Alert, Switch, Drawer, Radio, Checkbox } from 'antd';
import { ReloadOutlined, EllipsisOutlined, DeleteOutlined, DownloadOutlined, SettingOutlined, UndoOutlined, EyeOutlined, StopOutlined, DownOutlined, FilePdfOutlined, FileWordOutlined, FileOutlined, FileZipOutlined } from '@ant-design/icons';
import { listSecurityReportTasks, getSecurityReportTask, cancelSecurityReportTask, getSecurityReportTaskOutputs, removeSecurityReportTask, batchRemoveSecurityReportTasks } from '../../../services/leasedLineApi';
import { listLeasedLines } from '../../../services/leasedLineApi';
import { getDifyConfig as apiGetDifyConfig, updateDifyConfig as apiUpdateDifyConfig } from '../../../services/systemApi';
import { API_BASE_URL } from '../../../services/api';

type Props = {
  startedTaskId?: string;
  onClearStartedTaskId?: () => void;
};

const TasksPage: React.FC<Props> = ({ startedTaskId, onClearStartedTaskId }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [list, setList] = useState<any[]>([]);
  const [difyRootBase, setDifyRootBase] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [filterTenantName, setFilterTenantName] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [filterRange, setFilterRange] = useState<any[]>([]);

  const [cfgModalOpen, setCfgModalOpen] = useState(false);
  const [cfgForm] = Form.useForm();

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<any | undefined>(undefined);
  const [detailLines, setDetailLines] = useState<string[]>([]);
  const [detailUrl, setDetailUrl] = useState<string | undefined>(undefined);
  const detailEventSourceRef = useRef<EventSource | null>(null);
  const [detailObjs, setDetailObjs] = useState<any[]>([]);
  const [detailOutputs, setDetailOutputs] = useState<any | undefined>(undefined);
  const [streamFilter, setStreamFilter] = useState<string>('');
  const [streamAutoScroll, setStreamAutoScroll] = useState<boolean>(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | undefined>(undefined);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logDrawerTitle, setLogDrawerTitle] = useState<string>('');
  const [logDrawerContent, setLogDrawerContent] = useState<string>('');

  const [dlModalOpen, setDlModalOpen] = useState(false);
  const [dlIsBatch, setDlIsBatch] = useState(false);
  const [dlTargetTask, setDlTargetTask] = useState<any>(undefined);
  const [dlFormats, setDlFormats] = useState<string[]>(['docx']);



  const fetchTasks = async () => {
    try {
      setTasksLoading(true);
      const r = await listSecurityReportTasks();
      setTasks(r?.tasks || []);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '获取任务失败');
    } finally {
      setTasksLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGetDifyConfig();
        const base = String(res?.config?.baseUrl || '').trim();
        const root = base ? base.replace(/\/v1$/, '') : '';
        setDifyRootBase(root);
      } catch {}
    })();
    (async () => {
      try {
        const data = await listLeasedLines();
        setList(data || []);
      } catch {}
    })();
    fetchTasks();
    const timer = setInterval(() => { fetchTasks(); }, 10000);
    return () => clearInterval(timer);
  }, []);

  const openWorkflowConfig = async () => {
    try {
      const res = await apiGetDifyConfig();
      cfgForm.setFieldsValue({
        mode: res?.config?.mode || 'workflow',
        baseUrl: res?.config?.baseUrl || 'http://127.0.0.1/v1',
        apiKey: '',
        workflowId: res?.config?.workflowId || 'security-report',
        fileVarName: res?.config?.fileVarName || 'csv',
        logsDir: res?.config?.logsDir || '',
        reportsDir: res?.config?.reportsDir || '',
      });
    } catch {}
    setCfgModalOpen(true);
  };

  const tenantNameByLineId = (lineId: string): string => {
    const name = list.find((x: any) => x.id === lineId)?.tenantName;
    return name ? String(name) : '-';
  };

  const downloadReport = async (r: any, type?: 'pdf' | 'docx' | 'WXB_ZIP') => {
    try {
      const meta = r?.fileMeta || {};
      let url = String(meta?.folderDownloadEndpoint || meta?.downloadEndpoint || '');
      if (!url) { message.warning('暂无可下载链接'); return; }
      
      const token = localStorage.getItem('token');
      if (token && !/[?&]token=/.test(url)) {
        url = url + (url.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`);
      }
      
      if (type) {
        url = url + (url.includes('?') ? `&type=${type}` : `?type=${type}`);
      }
      
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) { message.error('下载失败'); return; }
      const blob = await res.blob();
      const tn = tenantNameByLineId(r.lineId);
      const computedName = (tn && tn !== '-') ? `${tn}安全报告` : undefined;
      const baseName = String(meta?.name || computedName || '安全报告').trim().replace(/\.(docx|pdf|zip)$/i, '');
      
      let ext = '.docx';
      if (type === 'WXB_ZIP') ext = '.zip';
      else if (type) ext = `.${type}`;
      else if (meta?.format) ext = `.${meta.format}`;
      
      let name = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;
      if (type === 'WXB_ZIP' && !name.includes('网信办')) {
          name = `${baseName}_网信办报告打包${ext}`;
      }
      
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      message.error('下载失败');
    }
  };

  const downloadSelectedReports = async (type: 'pdf' | 'docx' | 'WXB_ZIP') => {
    try {
      if (!selectedRowKeys.length) { message.warning('请先选择任务'); return; }
      const map = new Map<string, any>(tasks.map((t) => [t.id, t]));
      let success = 0;
      let skipped = 0;
      for (const id of selectedRowKeys) {
        const r = map.get(id);
        if (!r) { skipped++; continue; }
        const meta = r?.fileMeta || {};
        const has = !!(meta?.folderDownloadEndpoint || meta?.downloadEndpoint);
        if (!has) { skipped++; continue; }
        await downloadReport(r, type);
        success++;
        await new Promise(res => setTimeout(res, 300));
      }
      if (success) message.success(`已触发下载：${success} 个`);
      if (skipped) message.info(`无法下载或未生成：${skipped} 个`);
    } catch {
      message.error('批量下载失败');
    }
  };

  const handleDownloadClick = (isBatch: boolean, task?: any) => {
    setDlIsBatch(isBatch);
    setDlTargetTask(task);
    
    // Determine default format
    let defaultFormats: string[] = ['docx'];
    if (!isBatch && task) {
        const reportFiles = task.reportFiles || [];
        const hasPdf = reportFiles.some((f: any) => String(f.type).toLowerCase() === 'pdf');
        const hasDocx = reportFiles.some((f: any) => String(f.type).toLowerCase() === 'docx');
        const hasZip = reportFiles.some((f: any) => String(f.type).toLowerCase() === 'wxb_zip');
        
        defaultFormats = [];
        if (hasDocx) defaultFormats.push('docx');
        if (hasPdf) defaultFormats.push('pdf');
        if (hasZip) defaultFormats.push('WXB_ZIP');
        if (defaultFormats.length === 0) defaultFormats = ['docx'];
    }
    setDlFormats(defaultFormats);
    setDlModalOpen(true);
  };

  // moved below derive helpers to avoid "Cannot access 'deriveStatus' before initialization"

  const latestStreamNode = (r: any): any => {
    const arr = r?.streamLines || [];
    let node: any = undefined;
    if (Array.isArray(arr) && arr.length) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        const s = typeof it === 'string' ? it.trim() : undefined;
        let obj: any = it;
        if (typeof it === 'string') {
          let t = s || '';
          if (t.startsWith('data:')) t = t.slice(5).trim();
          try { obj = JSON.parse(t); } catch {}
        }
        if (obj?.event === 'workflow_finished') { node = obj; break; }
      }
      if (!node) {
        const last = arr[arr.length - 1];
        const s = typeof last === 'string' ? last.trim() : undefined;
        if (typeof last === 'string') {
          let t = s || '';
          if (t.startsWith('data:')) t = t.slice(5).trim();
          try { node = JSON.parse(t); } catch { node = last; }
        } else {
          node = last;
        }
      }
    } else {
      node = r?.response || r;
    }
    return node;
  };

  const deriveStatus = (r: any): string => {
    if (r?.status === 'succeeded' || r?.status === 'failed' || r?.status === 'canceled') return r.status;
    const node = latestStreamNode(r);
    const s = node?.data?.status || node?.status;
    if (node?.event === 'workflow_finished') return String(s || 'succeeded');
    return String(r?.status || 'running');
  };

  const derivePercent = (r: any): number => {
    if (r?.status === 'succeeded' || deriveStatus(r) === 'succeeded') return 100;
    
    // 1. 尝试直接查找 workflow_finished 事件
    const arr = r?.streamLines || [];
    if (Array.isArray(arr)) {
      for (let i = arr.length - 1; i >= 0; i--) {
         const node = parseNode(arr[i]);
         if (node?.event === 'workflow_finished') return 100;
      }
    }

    // 2. 倒序查找包含有效步骤信息的节点（解决"中间日志无进度信息导致闪烁"的问题）
    let validNode: any = undefined;
    if (Array.isArray(arr)) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const node = parseNode(arr[i]);
        const t = Number(node?.data?.total_steps || node?.total_steps || 0);
        const s = Number(node?.data?.sequence_number || node?.sequence_number || -1);
        if (t > 0 && s >= 0) {
          validNode = node;
          break;
        }
      }
    }
    
    if (validNode) {
       const total = Number(validNode?.data?.total_steps || validNode?.total_steps || 0);
       const seq = Number(validNode?.data?.sequence_number || validNode?.sequence_number || 0);
       if (total > 0) return Math.max(0, Math.min(100, Math.round(seq * 100 / total)));
    }
    
    return Number(r?.percent || 0);
  };

  const parseNode = (it: any) => {
      if (typeof it === 'string') {
        let t = it.trim();
        if (t.startsWith('data:')) t = t.slice(5).trim();
        try { return JSON.parse(t); } catch { return null; }
      }
      return it;
  };

  const deriveNodeIndex = (r: any): number | undefined => {
    const node = latestStreamNode(r);
    const seq = node?.data?.sequence_number ?? node?.sequence_number;
    if (typeof seq === 'number') return seq;
    const arr = Array.isArray(r?.streamLines) ? r.streamLines : [];
    if (arr.length) {
      const finished = arr.filter((it: any) => {
        let obj: any = it;
        if (typeof it === 'string') {
           let t = it.trim();
           if (t.startsWith('data:')) t = t.slice(5).trim();
           try { obj = JSON.parse(t); } catch {}
        }
        return obj?.event === 'node_finished';
      }).length;
      return finished || arr.length;
    }
    return undefined;
  };

  const filteredTasks = useMemo(() => {
    const nameMatch = (tid: string) => {
      const tn = tenantNameByLineId(tid);
      const a = String(tn || '').trim().toLowerCase();
      const b = String(filterTenantName || '').trim().toLowerCase();
      if (!b) return true;
      return a.includes(b);
    };
    const statusMatch = (t: any) => {
      const s = deriveStatus(t);
      if (!filterStatus) return true;
      return String(s) === String(filterStatus);
    };
    const timeMatch = (ts: number) => {
      if (!filterRange || !Array.isArray(filterRange) || filterRange.length !== 2 || !filterRange[0] || !filterRange[1]) return true;
      const start = Number((filterRange[0] as any).valueOf?.() ?? filterRange[0]);
      const end = Number((filterRange[1] as any).valueOf?.() ?? filterRange[1]);
      const t = Number(ts || 0);
      return t >= start && t <= end;
    };
    return (tasks || []).filter((t) => nameMatch(t.lineId) && statusMatch(t) && timeMatch(t.updatedAt));
  }, [tasks, filterTenantName, filterStatus, filterRange, list]);

  const openDetailStream = (id: string) => {
    try {
      if (detailEventSourceRef.current) { detailEventSourceRef.current.close(); detailEventSourceRef.current = null; }
      const es = new EventSource(`${API_BASE_URL}/api/leased-lines/security-report/tasks/${encodeURIComponent(id)}/stream${(() => { const t = localStorage.getItem('token'); return t ? `?token=${encodeURIComponent(t)}` : ''; })()}`);
      detailEventSourceRef.current = es;
      es.onmessage = (ev) => {
        try {
          const obj = JSON.parse(String(ev.data || '{}'));
          if (obj?.type === 'init' && obj?.task) {
            setDetailTask(obj.task);
            const arr = obj.task?.streamLines || [];
            setDetailObjs(arr);
            const texts = arr.map((x: any) => { try { return JSON.stringify(x); } catch { return String(x); } });
            setDetailLines(texts);
            const last = arr.length ? arr[arr.length - 1] : undefined;
            const url = (() => {
              const o = obj?.task?.data?.outputs || obj?.task?.outputs || {};
              const rawDoc = String(o?.doc || '').replace(/[`]/g, '').trim();
              const rawPdf = String(o?.pdf || '').replace(/[`]/g, '').trim();
              if (rawDoc) return rawDoc;
              if (rawPdf) return rawPdf;
              return undefined;
            })();
            if (url) setDetailUrl(url);
            const outsInit = obj?.task?.data?.outputs || obj?.task?.outputs || undefined;
            if (outsInit) setDetailOutputs(outsInit);
          } else if (obj?.type === 'stream') {
            const s = (() => { try { return JSON.stringify(obj.line); } catch { return String(obj.line); } })();
            setDetailLines(prev => [...prev, s].slice(-2000));
            setDetailObjs(prev => [...prev, obj.line]);
            const url = (() => {
              const o = obj?.line?.data?.outputs || obj?.line?.outputs || {};
              const rawDoc = String(o?.doc || '').replace(/[`]/g, '').trim();
              const rawPdf = String(o?.pdf || '').replace(/[`]/g, '').trim();
              if (rawDoc) return rawDoc;
              if (rawPdf) return rawPdf;
              return undefined;
            })();
            if (url) setDetailUrl(url);
            const outs = obj?.line?.data?.outputs || obj?.line?.outputs || undefined;
            if (outs) setDetailOutputs(outs);
          }
        } catch {}
      };
      es.onerror = () => { try { es.close(); } catch {} };
    } catch {}
  };

  const openTaskDetail = async (id: string) => {
    try {
      setDetailModalOpen(true);
      setDetailTask(undefined);
      setDetailLines([]);
      setDetailObjs([]);
      setDetailUrl(undefined);
      setDetailOutputs(undefined);
      const r = await getSecurityReportTask(id);
      const t = r?.task;
      setDetailTask(t);
      const arr = t?.streamLines || [];
      setDetailObjs(arr);
      const texts = arr.map((x: any) => { try { return JSON.stringify(x); } catch { return String(x); } });
      setDetailLines(texts);
      const last = arr.length ? arr[arr.length - 1] : undefined;
      const url = (() => {
        const o = t?.data?.outputs || t?.outputs || {};
        const rawDoc = String(o?.doc || '').replace(/[`]/g, '').trim();
        const rawPdf = String(o?.pdf || '').replace(/[`]/g, '').trim();
        if (rawDoc) return rawDoc;
        if (rawPdf) return rawPdf;
        return undefined;
      })();
      if (url) setDetailUrl(url);
      try {
        const o = await getSecurityReportTaskOutputs(id);
        setDetailOutputs(o?.outputs || {});
      } catch {}
      openDetailStream(id);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '获取任务详情失败');
    }
  };

  useEffect(() => {
    if (startedTaskId) {
      fetchTasks();
      if (onClearStartedTaskId) onClearStartedTaskId();
    }
  }, [startedTaskId]);

  useEffect(() => {
    if (!streamAutoScroll) return;
    try {
      const el = document.getElementById('stream-box');
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }, [detailObjs, streamAutoScroll]);

  return (
    <div>
      <div className="filters-row">
        <Form
          className="filter-tools"
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
        >
          <Form.Item label="时间范围">
            <DatePicker.RangePicker allowClear value={filterRange as any} onChange={(vals) => setFilterRange(Array.isArray(vals) ? vals : [])} />
          </Form.Item>
          <Form.Item label="租户名称">
            <Input allowClear placeholder="搜索租户名称" value={filterTenantName} onChange={(e) => setFilterTenantName(e.target.value)} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item label="状态">
            <Select allowClear placeholder="全部" value={filterStatus} onChange={(v) => setFilterStatus(v)} style={{ width: 180 }}
              options={[
                { value: 'pending', label: 'pending' },
                { value: 'running', label: 'running' },
                { value: 'succeeded', label: 'succeeded' },
                { value: 'failed', label: 'failed' },
                { value: 'canceled', label: 'canceled' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Button type="link" size="small" icon={<UndoOutlined />} style={{ marginLeft: 0, paddingLeft: 0 }} onClick={() => { setFilterTenantName(''); setFilterStatus(undefined); setFilterRange([]); }}>重置</Button>
          </Form.Item>
        </Form>
        <AntSpace className="filter-actions">
          <Dropdown
            menu={{
              items: [
                { key: 'download', label: `批量下载报告${selectedRowKeys.length?`(${selectedRowKeys.length})`:''}`, icon: <DownloadOutlined />, disabled: !selectedRowKeys.length },
                { key: 'delete', label: `批量删除任务${selectedRowKeys.length?`(${selectedRowKeys.length})`:''}`, icon: <DeleteOutlined />, disabled: !selectedRowKeys.length },
                { type: 'divider' },
                { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
                { key: 'config', label: '引擎配置', icon: <SettingOutlined /> },
              ],
              onClick: async ({ key }) => {
                if (key === 'refresh') { fetchTasks(); return; }
                if (key === 'config') { openWorkflowConfig(); return; }
                if (key === 'download') { if (!selectedRowKeys.length) { message.info('请先选择任务'); return; } handleDownloadClick(true); return; }
                if (key === 'delete') {
                  if (!selectedRowKeys.length) { message.info('请先选择任务'); return; }
                  Modal.confirm({
                    title: '确认批量删除所选任务？',
                    content: `将删除 ${selectedRowKeys.length} 个任务，删除后不可恢复；已生成的报告文件不随任务删除。`,
                    okText: '批量删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: async () => {
                      try {
                        const resp = await batchRemoveSecurityReportTasks(selectedRowKeys);
                        const n = Number(resp?.deleted || 0);
                        if (n) message.success(`已删除 ${n} 个任务`); else message.info('未删除任何任务');
                        setSelectedRowKeys([]);
                        fetchTasks();
                      } catch (e: any) {
                        const msg = e?.response?.data?.message || e?.message || '批量删除失败';
                        message.error(msg);
                      }
                    }
                  });
                  return;
                }
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
        className="vr-table"
        rowKey={(r: any) => r.id}
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }}
        dataSource={filteredTasks}
        loading={tasksLoading}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '任务ID', dataIndex: 'id', sorter: (a: any, b: any) => String(a.id).localeCompare(String(b.id)), sortDirections: ['ascend','descend'] },
          { title: '租户名称', key: 'tenantName', render: (_: any, r: any) => tenantNameByLineId(r.lineId), sorter: (a: any, b: any) => String(tenantNameByLineId(a.lineId)).localeCompare(String(tenantNameByLineId(b.lineId))), sortDirections: ['ascend','descend'] },
          { title: '状态', key: 'status', render: (_: any, r: any) => {
            const s = deriveStatus(r);
            const color = s==='succeeded'?'green':s==='failed'?'red':s==='canceled'?'orange':'blue';
            return <Tag color={color}>{s}</Tag>;
          }, sorter: (a: any, b: any) => String(deriveStatus(a)).localeCompare(String(deriveStatus(b))), sortDirections: ['ascend','descend'] },
          { title: '进度', key: 'percent', width: 180, render: (_: any, r: any) => {
            const p = derivePercent(r);
            const s = deriveStatus(r);
            const st = s==='failed'?'exception':s==='succeeded'?'success':'active';
            const idx = deriveNodeIndex(r);
            return <div style={{ minWidth: 160 }}>
              <Progress percent={p} size="small" status={st} />
              <div style={{ fontSize: 12, color: '#888' }}>{typeof idx === 'number' ? `流节点：${idx}` : ''}</div>
            </div>;
          }, sorter: (a: any, b: any) => Number(derivePercent(a)) - Number(derivePercent(b)), sortDirections: ['ascend','descend'] },
          { title: '文件名', key: 'fileinfo', render: (_: any, r: any) => {
            const meta = r?.fileMeta || {};
            const reportFiles = r?.reportFiles || [];
            const tn = tenantNameByLineId(r.lineId);
            const computedName = (tn && tn !== '-') ? `${tn}安全报告.docx` : undefined;
            const name = String(meta?.name || computedName || '安全报告.docx').trim();
            const sizeBytes = (typeof meta?.sizeBytes === 'number') ? meta.sizeBytes : undefined;
            
            const formatSize = (bytes: number) => {
                 if (!bytes) return '0 B';
                 const k = 1024;
                 const sizes = ['B', 'KB', 'MB', 'GB'];
                 const i = Math.floor(Math.log(bytes) / Math.log(k));
                 return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            };

            if (reportFiles && reportFiles.length > 0) {
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {reportFiles.map((f: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {String(f.type).toLowerCase() === 'pdf' ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : 
                                 String(f.type).toLowerCase() === 'docx' ? <FileWordOutlined style={{ color: '#1677ff' }} /> : 
                                 String(f.type).toLowerCase() === 'wxb_zip' ? <FileZipOutlined style={{ color: '#faad14' }} /> :
                                 <FileOutlined />}
                                <span style={{ fontSize: 13 }}>{f.filename || f.name}</span>
                                <span style={{ color: '#999', fontSize: 12 }}>
                                  {f.size ? formatSize(f.size) : ''}
                                </span>
                            </div>
                        ))}
                    </div>
                );
            }
              
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                 <FileWordOutlined style={{ color: '#1677ff' }} />
                 <span style={{ fontSize: 13 }}>{name}</span>
                 {typeof sizeBytes === 'number' ? <span style={{ color: '#999', fontSize: 12 }}>{formatSize(sizeBytes)}</span> : null}
              </div>
            );
          } },
          { title: '更新时间', dataIndex: 'updatedAt', render: (t: number) => new Date(t).toLocaleString() },
          { title: '操作', key: 'actions', fixed: 'right', width: 160, render: (_: any, r: any) => {
            const meta = r?.fileMeta || {};
            const downloadUrl = String(meta?.folderDownloadEndpoint || meta?.downloadEndpoint || '');
            const canDownload = !!downloadUrl;
            const wxbZip = (r.reportFiles || []).find((f: any) => f.type === 'WXB_ZIP');
            
            const items = [
              { key: 'detail', label: '查看详情', icon: <EyeOutlined /> },
              canDownload ? { key: 'download', label: '下载报告', icon: <DownloadOutlined /> } : null,
              wxbZip ? { key: 'download_wxb', label: '下载网信办报告', icon: <FileZipOutlined /> } : null,
              (deriveStatus(r)==='running') ? { key: 'cancel', label: '取消任务', danger: true, icon: <StopOutlined /> } : null,
              { key: 'remove', label: '删除任务', danger: true, icon: <DeleteOutlined /> },
            ].filter(Boolean) as any[];
            const menu = {
              items,
              onClick: async ({ key }: any) => {
                if (key === 'detail') { openTaskDetail(r.id); return; }
                if (key === 'download') { handleDownloadClick(false, r); return; }
                if (key === 'download_wxb') { 
                    const token = localStorage.getItem('token');
                    window.open(`${API_BASE_URL}/api/leased-lines/security-report/tasks/${r.id}/download?type=WXB_ZIP${token ? `&token=${token}` : ''}`, '_blank');
                    return; 
                }
                if (key === 'cancel') { try { await cancelSecurityReportTask(r.id); fetchTasks(); } catch {} return; }
                if (key === 'remove') {
                  Modal.confirm({
                    title: '确认删除该任务？',
                    content: '删除后不可恢复；已生成的报告文件不随任务删除',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    onOk: async () => { try { await removeSecurityReportTask(r.id); fetchTasks(); } catch { message.error('删除失败'); } }
                  });
                  return;
                }
              }
            } as any;
            return (
              <Dropdown menu={menu} trigger={["click"]}>
                <Button type="text" icon={<EllipsisOutlined />} />
              </Dropdown>
            );
          } }
        ]}
      />

      <Modal
        title="引擎配置"
        open={cfgModalOpen}
        onCancel={() => setCfgModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form form={cfgForm} layout="vertical" style={{ maxWidth: 520 }} onFinish={async (values) => {
          try {
            const payload: any = {
              baseUrl: String(values.baseUrl || '').trim(),
              workflowId: String(values.workflowId || '').trim(),
              logsDir: String(values.logsDir || '').trim() || undefined,
              reportsDir: String(values.reportsDir || '').trim() || undefined,
              mode: values.mode || 'workflow',
              fileVarName: String(values.fileVarName || '').trim() || undefined,
            };
            const key = String(values.apiKey || '').trim();
            if (key) payload.apiKey = key;
            await apiUpdateDifyConfig(payload);
            message.success('Dify 配置已保存');
            setCfgModalOpen(false);
            // 更新根地址
            const base = String(payload.baseUrl || '').trim();
            const root = base ? base.replace(/\/v1$/, '') : '';
            setDifyRootBase(root);
          } catch (e: any) {
            message.error(e?.response?.data?.message || e?.message || '保存失败');
          }
        }}>
          <Form.Item label="应用模式" name="mode" rules={[{ required: true, message: '请选择应用模式' }]}> 
            <Select style={{ width: 360 }} options={[{ value: 'workflow', label: '工作流应用' }, { value: 'chat', label: '聊天应用' }]} />
          </Form.Item>
          <Form.Item label="服务器地址" name="baseUrl" rules={[{ required: true, message: '请输入 Dify 服务器地址' }]}> 
            <Input placeholder="http://127.0.0.1/v1" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" extra="留空则保留已有的秘钥"> 
            <Input.Password placeholder="app-xxxxxxxxxxxxxxxx" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="工作流ID" name="workflowId" rules={[{ required: true, message: '请输入工作流ID' }]}> 
            <Input placeholder="security-report" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="文件变量名（工作流）" name="fileVarName" extra="例如 csv 或 alarm_file，需与工作流表单变量名称一致"> 
            <Input placeholder="csv" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="告警日志目录（可选）" name="logsDir"> 
            <Input placeholder="backend/data/security-logs" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="报告输出目录（可选）" name="reportsDir"> 
            <Input placeholder="backend/data/security-reports" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存配置</Button>
          </Form.Item>
        </Form>
      </Modal>



      <Modal
        title="任务详情"
        open={detailModalOpen}
        onCancel={() => { setDetailModalOpen(false); if (detailEventSourceRef.current) { detailEventSourceRef.current.close(); detailEventSourceRef.current = null; } setDetailTask(undefined); setDetailLines([]); setDetailObjs([]); setDetailUrl(undefined); setStreamFilter(''); }}
        footer={<Button onClick={() => setDetailModalOpen(false)}>关闭</Button>}
        width={960}
        destroyOnHidden
      >
        <Tabs defaultActiveKey="overview">
          <Tabs.TabPane tab="总览" key="overview">
            {(() => {
              const formatSize = (bytes: number) => {
                if (!bytes) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
              };
              const s = (() => { try { return deriveStatus(detailTask || {}); } catch { return detailTask?.status; } })();
              const color = s==='succeeded'?'green':s==='failed'?'red':s==='canceled'?'orange':'blue';
              const listItem = tasks.find((x:any) => x.id === detailTask?.id);
              const meta = listItem?.fileMeta || {};
              const reportFiles = listItem?.reportFiles || [];
              const tn = tenantNameByLineId(detailTask?.lineId || '');
              const computedName = tn && tn !== '-' ? `${tn}安全报告` : undefined;
              const name = meta?.name || (computedName ? `${computedName}.docx` : '安全报告.docx');
              
              return (
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                    <Progress percent={Number(detailTask?.percent || 0)} status={s==='failed'?'exception':(s==='succeeded'?'success':'active')} style={{ width: 280 }} />
                    <Tag color={color}>{s || '-'}</Tag>
                  </div>
                  {s==='failed' && detailTask?.message ? <Alert style={{ marginTop: 12, maxWidth: 720 }} type="error" message={String(detailTask?.message)} showIcon /> : null}
                  <Descriptions style={{ marginTop: 12 }} column={2} size="small" bordered>
                    <Descriptions.Item label="任务ID">{detailTask?.id || '-'}</Descriptions.Item>
                    <Descriptions.Item label="租户">{tn || '-'}</Descriptions.Item>
                    <Descriptions.Item label="更新时间">{detailTask?.updatedAt ? new Date(detailTask.updatedAt).toLocaleString() : '-'}</Descriptions.Item>
                    <Descriptions.Item label="生成报告" span={2}>
                      {reportFiles && reportFiles.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
                          {reportFiles.map((f: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {String(f.type).toLowerCase() === 'pdf' ? <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 16 }} /> : 
                                 String(f.type).toLowerCase() === 'docx' ? <FileWordOutlined style={{ color: '#1677ff', fontSize: 16 }} /> : 
                                 <FileOutlined style={{ fontSize: 16 }} />}
                                <span style={{ fontWeight: 500 }}>{f.filename || f.name}</span>
                                <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>
                                  {f.size ? formatSize(f.size) : '-'}
                                </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                           <FileWordOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                           <span>{String(name || '-')}</span>
                           {typeof meta?.sizeBytes === 'number' ? <span style={{ color: '#888', fontSize: 12 }}>{formatSize(meta.sizeBytes)}</span> : null}
                        </div>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                  <div style={{ marginTop: 12 }}>
                    {meta?.downloadEndpoint || meta?.folderDownloadEndpoint ? (
                        <Button type="primary" onClick={() => handleDownloadClick(false, listItem || detailTask)} style={{ marginRight: 8 }}>下载报告</Button>
                    ) : null}
                    {detailUrl ? <a href={detailUrl} target="_blank" rel="noreferrer"><Button>打开报告URL</Button></a> : null}
                  </div>
                </div>
              );
            })()}
          </Tabs.TabPane>
          <Tabs.TabPane tab="输出" key="outputs">
            <div style={{ marginBottom: 8 }}>
              <Alert type="info" message="展示工作流输出的结构化字段" showIcon />
            </div>
            <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid #eee', padding: 8, borderRadius: 4 }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{(() => { try { return JSON.stringify(detailOutputs ?? {}, null, 2); } catch { return String(detailOutputs ?? ''); } })()}</pre>
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab="流日志" key="stream">
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom: 8 }}>
              <Input.Search allowClear placeholder="搜索日志" style={{ width: 240 }} value={streamFilter} onChange={(e) => setStreamFilter(e.target.value)} />
              <span>自动滚动</span>
              <Switch checked={streamAutoScroll} onChange={setStreamAutoScroll} />
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => { if (detailTask?.id) openTaskDetail(detailTask.id); }}
              >
                刷新
              </Button>
            </div>
            <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid #eee', padding: 8, borderRadius: 4 }} id="stream-box">
              <Timeline
                items={(detailObjs || []).map((o, idx) => {
                  const label = (() => {
                    const id = o?.id || o?.data?.id || o?.event || o?.status || `node-${idx+1}`;
                    return `#${idx+1} ${String(id)}`;
                  })();
                  const content = (() => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } })();
                  if (streamFilter && !content.toLowerCase().includes(streamFilter.toLowerCase())) return null as any;
                  return {
                    color: idx === (detailObjs.length - 1) ? 'green' : 'blue',
                    children: (
                        <div
                          onClick={() => { setLogDrawerTitle(label); setLogDrawerContent(content); setLogDrawerOpen(true); }}
                          style={{ cursor: 'pointer', padding: 6, borderRadius: 4, transition: 'all 0.2s' }}
                        >
                          {label}
                        </div>
                    )
                  };
                }).filter(Boolean) as any}
              />
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab="原始" key="raw">
            <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid #eee', padding: 8, borderRadius: 4 }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{(() => { const obj = detailTask?.response || (detailObjs.length ? detailObjs[detailObjs.length-1] : {}); try { return JSON.stringify(obj ?? {}, null, 2); } catch { return String(obj ?? ''); } })()}</pre>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Modal>

      <Drawer
        title={logDrawerTitle || '日志详情'}
        open={logDrawerOpen}
        onClose={() => setLogDrawerOpen(false)}
        width={720}
        zIndex={1050}
        extra={<Button onClick={() => { try { navigator.clipboard.writeText(logDrawerContent); message.success('已复制'); } catch {} }}>复制</Button>}
      >
        <div style={{ maxHeight: '70vh', overflow: 'auto', border: '1px solid #eee', padding: 8, borderRadius: 4 }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{logDrawerContent}</pre>
        </div>
      </Drawer>

      <Modal
        title="选择下载格式"
        open={dlModalOpen}
        onCancel={() => setDlModalOpen(false)}
        onOk={async () => {
            setDlModalOpen(false);
            if (dlIsBatch) {
                for (const fmt of dlFormats) {
                    await downloadSelectedReports(fmt as any);
                    await new Promise(r => setTimeout(r, 1000));
                }
            } else if (dlTargetTask) {
                for (const fmt of dlFormats) {
                    await downloadReport(dlTargetTask, fmt as any);
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }}
        okText="确认下载"
        cancelText="取消"
        width={400}
        destroyOnHidden
      >
        <div style={{ padding: '20px 0' }}>
            <p style={{ marginBottom: 12 }}>请选择要下载的报告文件格式（可多选）：</p>
            <Checkbox.Group value={dlFormats} onChange={(vals) => setDlFormats(vals as string[])}>
                <AntSpace direction="vertical">
                    <Checkbox value="pdf" disabled={!dlIsBatch && dlTargetTask && dlTargetTask.reportFiles?.length > 0 && !dlTargetTask.reportFiles.some((f:any)=>String(f.type).toLowerCase() === 'pdf')}>
                        PDF 格式 (.pdf)
                    </Checkbox>
                    <Checkbox value="docx" disabled={!dlIsBatch && dlTargetTask && dlTargetTask.reportFiles?.length > 0 && !dlTargetTask.reportFiles.some((f:any)=>String(f.type).toLowerCase() === 'docx')}>
                        Word 格式 (.docx)
                    </Checkbox>
                    <Checkbox value="WXB_ZIP" disabled={!dlIsBatch && dlTargetTask && dlTargetTask.reportFiles?.length > 0 && !dlTargetTask.reportFiles.some((f:any)=>String(f.type).toLowerCase() === 'wxb_zip')}>
                        网信办报告打包 (.zip)
                    </Checkbox>
                </AntSpace>
            </Checkbox.Group>
            {dlIsBatch && (
                <div style={{ marginTop: 16, color: '#888', fontSize: 12 }}>
                    注意：如果选定格式的文件不存在，部分任务可能会下载失败。
                </div>
            )}
        </div>
      </Modal>
    </div>
  );
};

export default TasksPage;