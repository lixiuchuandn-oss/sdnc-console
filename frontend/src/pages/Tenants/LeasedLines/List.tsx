import React, { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Form, Input, Select, Space as AntSpace, Table, Tag, Modal, Row, Col, message, Dropdown, DatePicker } from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined, UploadOutlined, ReloadOutlined, EllipsisOutlined, FileWordOutlined, DeleteOutlined, UndoOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { listLeasedLines, createLeasedLine, batchImportLeasedLines, updateLeasedLine, deleteLeasedLine, startSecurityReportTask, batchDeleteLeasedLines } from '../../../services/leasedLineApi';
import type { TenantLeasedLine } from '../../../types/leasedLine';
import '../../common/filters.css';

type Props = {
  onStartTask?: (taskId: string) => void;
};

const provinces = [
  '北京市','天津市','上海市','重庆市','河北省','山西省','辽宁省','吉林省','黑龙江省','江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','海南省','四川省','贵州省','云南省','陕西省','甘肃省','青海省','台湾省','内蒙古自治区','广西壮族自治区','西藏自治区','宁夏回族自治区','新疆维吾尔自治区','香港特别行政区','澳门特别行政区'
];
const cityOptionsByProvince: Record<string, string[]> = {
  '北京市': ['北京市'],
  '上海市': ['上海市'],
  '天津市': ['天津市'],
  '重庆市': ['重庆市'],
  '河北省': ['石家庄市','唐山市','秦皇岛市','邯郸市','邢台市','保定市','张家口市','承德市','沧州市','廊坊市','衡水市'],
  '山西省': ['太原市','大同市','阳泉市','长治市','晋城市','朔州市','晋中市','运城市','忻州市','临汾市','吕梁市'],
  '辽宁省': ['沈阳市','大连市','鞍山市','抚顺市','本溪市','丹东市','锦州市','营口市','阜新市','辽阳市','盘锦市','铁岭市','朝阳市','葫芦岛市'],
  '吉林省': ['长春市','吉林市','四平市','辽源市','通化市','白山市','松原市','白城市','延边朝鲜族自治州'],
  '黑龙江省': ['哈尔滨市','齐齐哈尔市','牡丹江市','佳木斯市','大庆市','伊春市','鸡西市','鹤岗市','双鸭山市','七台河市','黑河市','绥化市','大兴安岭地区'],
  '江苏省': ['南京市','苏州市','无锡市','常州市','扬州市','镇江市','南通市','泰州市','盐城市','徐州市','连云港市','淮安市','宿迁市'],
  '浙江省': ['杭州市','宁波市','温州市','嘉兴市','湖州市','绍兴市','金华市','衢州市','舟山市','台州市','丽水市'],
  '安徽省': ['合肥市','芜湖市','蚌埠市','淮南市','马鞍山市','淮北市','铜陵市','安庆市','黄山市','滁州市','阜阳市','宿州市','六安市','亳州市','池州市','宣城市'],
  '福建省': ['福州市','厦门市','莆田市','三明市','泉州市','漳州市','南平市','龙岩市','宁德市'],
  '江西省': ['南昌市','赣州市','宜春市','上饶市','抚州市','吉安市','九江市','景德镇市','新余市','鹰潭市','萍乡市','贵溪市'],
  '山东省': ['济南市','青岛市','淄博市','枣庄市','东营市','烟台市','潍坊市','济宁市','泰安市','威海市','日照市','临沂市','德州市','聊城市','滨州市','菏泽市'],
  '河南省': ['郑州市','开封市','洛阳市','平顶山市','安阳市','鹤壁市','新乡市','焦作市','濮阳市','许昌市','漯河市','三门峡市','南阳市','商丘市','信阳市','周口市','驻马店市','济源示范区'],
  '湖北省': ['武汉市','黄石市','十堰市','宜昌市','襄阳市','鄂州市','荆门市','孝感市','荆州市','黄冈市','咸宁市','随州市','恩施土家族苗族自治州'],
  '湖南省': ['长沙市','株洲市','湘潭市','衡阳市','邵阳市','岳阳市','常德市','张家界市','益阳市','郴州市','永州市','怀化市','娄底市','湘西土家族苗族自治州'],
  '广东省': ['广州市','深圳市','珠海市','佛山市','东莞市','中山市','惠州市','江门市','汕头市','湛江市','茂名市','肇庆市','梅州市','汕尾市','清远市','阳江市','揭阳市','云浮市'],
  '海南省': ['海口市','三亚市','三沙市','儋州市'],
  '四川省': ['成都市','绵阳市','德阳市','南充市','乐山市','宜宾市','泸州市','达州市','内江市','广安市','资阳市','眉山市','雅安市','巴中市','广元市','遂宁市'],
  '贵州省': ['贵阳市','六盘水市','遵义市','安顺市','毕节市','铜仁市','黔东南苗族侗族自治州','黔南布依族苗族自治州','黔西南布依族苗族自治州'],
  '云南省': ['昆明市','曲靖市','玉溪市','保山市','昭通市','丽江市','普洱市','临沧市','楚雄彝族自治州','红河哈尼族彝族自治州','文山壮族苗族自治州','西双版纳傣族自治州','大理白族自治州','德宏傣族景颇族自治州','怒江傈僳族自治州','迪庆藏族自治州'],
  '陕西省': ['西安市','铜川市','宝鸡市','咸阳市','渭南市','延安市','汉中市','榆林市','安康市','商洛市'],
  '甘肃省': ['兰州市','嘉峪关市','金昌市','白银市','天水市','武威市','张掖市','平凉市','酒泉市','庆阳市','定西市','陇南市','临夏回族自治州','甘南藏族自治州'],
  '青海省': ['西宁市','海东市','海北藏族自治州','黄南藏族自治州','海南藏族自治州','果洛藏族自治州','玉树藏族自治州','海西蒙古族藏族自治州'],
  '台湾省': ['台北市','新北市','桃园市','台中市','台南市','高雄市'],
  '内蒙古自治区': ['呼和浩特市','包头市','乌海市','赤峰市','通辽市','鄂尔多斯市','呼伦贝尔市','巴彦淖尔市','乌兰察布市','兴安盟','锡林郭勒盟','阿拉善盟'],
  '广西壮族自治区': ['南宁市','柳州市','桂林市','梧州市','北海市','防城港市','钦州市','贵港市','玉林市','百色市','贺州市','河池市','来宾市','崇左市'],
  '西藏自治区': ['拉萨市','日喀则市','昌都市','林芝市','山南市','那曲市','阿里地区'],
  '宁夏回族自治区': ['银川市','石嘴山市','吴忠市','固原市','中卫市'],
  '新疆维吾尔自治区': ['乌鲁木齐市','克拉玛依市','吐鲁番市','哈密市','昌吉回族自治州','博尔塔拉蒙古自治州','巴音郭楞蒙古自治州','阿克苏地区','喀什地区','和田地区','伊犁哈萨克自治州','塔城地区','阿勒泰地区'],
  '香港特别行政区': ['香港'],
  '澳门特别行政区': ['澳门'],
};
const operators = ['中国电信', '中国移动', '中国联通', '广电'];

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
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importForm] = Form.useForm();

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
  const importProvince = Form.useWatch('defaultProvince', importForm);

  const createCityOptions = useMemo(() => {
    const p = createProvince;
    const dict = cityOptionsByProvince[p] || [];
    const data = Array.from(datasetCitiesByProvince.get(p || '') || new Set<string>());
    const merged = Array.from(new Set([...(dict || []), ...(data || [])]));
    return merged.map(c => ({ value: c, label: c }));
  }, [createProvince, datasetCitiesByProvince]);

  const importCityOptions = useMemo(() => {
    const p = importProvince;
    const dict = cityOptionsByProvince[p] || [];
    const data = Array.from(datasetCitiesByProvince.get(p || '') || new Set<string>());
    const merged = Array.from(new Set([...(dict || []), ...(data || [])]));
    return merged.map(c => ({ value: c, label: c }));
  }, [importProvince, datasetCitiesByProvince]);

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
    { title: '专线IP', dataIndex: 'ips', key: 'ips', render: (v: string) => <span>{v}</span>, sorter: (a, b) => String(a.ips || '').localeCompare(String(b.ips || '')), sortDirections: ['ascend','descend'] },
    { title: '告警日志', dataIndex: 'hasLog', key: 'hasLog', render: (_: any, r: TenantLeasedLine) => r.hasLog ? <Tag color="green">已上传</Tag> : <Tag color="red">未上传</Tag>, sorter: (a, b) => Number(!!a.hasLog) - Number(!!b.hasLog), sortDirections: ['ascend','descend'] },
    { title: '日志文件名', dataIndex: 'logFileName', key: 'logFileName', sorter: (a, b) => String(a.logFileName || '').localeCompare(String(b.logFileName || '')), sortDirections: ['ascend','descend'] },
    { title: '文件大小(Byte)', dataIndex: 'logFileSize', key: 'logFileSize', sorter: (a, b) => Number(a.logFileSize || 0) - Number(b.logFileSize || 0), sortDirections: ['ascend','descend'] },
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

  const parseImportText = (text: string, defProvince?: string, defCity?: string, defOp?: string) => {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const items: { tenantName: string; province: string; city: string; operator: string; ips: string[] }[] = [];
    for (const line of lines) {
      if (!line) continue;
      if (line.includes('专线IP')) {
        const [left, rightRaw] = line.split('专线IP');
        const tenantName = left.trim().replace(/[\s,]+$/,'');
        const ips = rightRaw.split(/[\s,;，、]+/).map(s => s.trim()).filter(Boolean);
        if (tenantName && ips.length) items.push({ tenantName, province: defProvince || '未知', city: defCity || '未知', operator: defOp || '未知', ips });
      } else {
        const parts = line.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const tenantName = parts[0];
          const ipStr = parts.slice(1).join(',');
          const ips = ipStr.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
          if (tenantName && ips.length) items.push({ tenantName, province: defProvince || '未知', city: defCity || '未知', operator: defOp || '未知', ips });
        }
      }
    }
    return items;
  };

  const handleImportSubmit = async () => {
    try {
      const values = await importForm.validateFields();
      const defCity = Array.isArray(values.defaultCity) ? String(values.defaultCity[0]).trim() : String(values.defaultCity || '').trim();
      const items = parseImportText(String(values.csvText || ''), values.defaultProvince, defCity, values.defaultOperator);
      if (!items.length) {
        message.warning('未解析到有效数据');
        return;
      }
      setImportSubmitting(true);
      const resp = await batchImportLeasedLines(items);
      message.success(`导入成功，创建 ${resp.created} 条记录`);
      setImportModalOpen(false);
      importForm.resetFields();
      fetchList();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '导入失败');
    } finally {
      setImportSubmitting(false);
    }
  };

  return (
    <>
      <div className="filters-row">
        <Form
          className="filter-tools"
          form={filterForm}
          layout="vertical"
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

      <Modal
        title="CSV 导入租户专线"
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); importForm.resetFields(); }}
        onOk={handleImportSubmit}
        okText={importSubmitting ? '导入中...' : '导入'}
        confirmLoading={importSubmitting}
        destroyOnHidden
        width={800}
      >
        <Form form={importForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="defaultProvince" label="默认省" rules={[{ required: true, message: '请选择默认省' }]}> 
                <Select showSearch placeholder="选择省" options={provinces.map(r => ({ value: r, label: r }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="defaultCity" label="默认市" rules={[{ required: true, message: '请选择默认市' }]}> 
                <Select 
                  showSearch 
                  mode="tags"
                  optionFilterProp="label"
                  placeholder="选择或输入默认城市"
                  tokenSeparators={[',','，','/',' ']}
                  options={importCityOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="defaultOperator" label="默认运营商" rules={[{ required: true, message: '请选择默认运营商' }]}>
                <Select placeholder="选择运营商" options={operators.map(o => ({ value: o, label: o }))} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="csvText" label="CSV 文本" rules={[{ required: true, message: '请粘贴CSV文本' }]} extra="支持两种格式：1）公司名,IP1,IP2；2）公司名\t专线IP IP1,IP2,IP3">
                <Input.TextArea rows={8} placeholder={"示例：\n贵溪市国有控股集团有限公司\t专线IP 115.153.156.247,115.153.156.248,115.153.156.249\n海利贵溪化工农药有限公司\t专线IP 111.78.212.54"} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
};

export default ListPage;