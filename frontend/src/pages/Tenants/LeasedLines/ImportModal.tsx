import React, { useState, useMemo } from 'react';
import { Modal, Form, Select, Input, Row, Col, message } from 'antd';
import { batchImportLeasedLines } from '../../../services/leasedLineApi';
import { provinces, cityOptionsByProvince, operators } from './constants';

type Props = {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  datasetCitiesByProvince: Map<string, Set<string>>;
};

const ImportModal: React.FC<Props> = ({ open, onCancel, onSuccess, datasetCitiesByProvince }) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const defaultProvince = Form.useWatch('defaultProvince', form);

  const cityOptions = useMemo(() => {
    const p = defaultProvince;
    const dict = cityOptionsByProvince[p] || [];
    const data = Array.from(datasetCitiesByProvince.get(p || '') || new Set<string>());
    const merged = Array.from(new Set([...(dict || []), ...(data || [])]));
    return merged.map(c => ({ value: c, label: c }));
  }, [defaultProvince, datasetCitiesByProvince]);

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
      const values = await form.validateFields();
      const defCity = (Array.isArray(values.defaultCity) && values.defaultCity.length > 0)
        ? String(values.defaultCity[0]).trim()
        : (typeof values.defaultCity === 'string' ? String(values.defaultCity).trim() : '');
      const items = parseImportText(String(values.csvText || ''), values.defaultProvince, defCity, values.defaultOperator);
      if (!items.length) {
        message.warning('未解析到有效数据');
        return;
      }
      setSubmitting(true);
      const resp = await batchImportLeasedLines(items);
      message.success(`导入成功，创建 ${resp.created} 条记录`);
      onSuccess();
      form.resetFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '导入失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="CSV 导入租户专线"
      open={open}
      onCancel={() => { onCancel(); form.resetFields(); }}
      onOk={handleImportSubmit}
      okText={submitting ? '导入中...' : '导入'}
      confirmLoading={submitting}
      destroyOnHidden
      width={800}
    >
      <Form form={form} layout="vertical">
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
                options={cityOptions} />
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
  );
};

export default ImportModal;
