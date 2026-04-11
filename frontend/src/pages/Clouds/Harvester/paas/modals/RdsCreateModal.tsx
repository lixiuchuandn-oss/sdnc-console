/**
 * 云数据库 RDS 实例专属创建弹窗
 *
 * 这是一个极简版创建向导，去除了常规虚拟机的复杂配置。
 * 特点：
 * - 默认将网络配置为 Kube-OVN 扁平子网。
 * - 默认注入 tower.io/rds、tower.io/paas-type；版本写入 tower.io/paas-ver（镜像标签优先，否则取表单 RDS 版本）。
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Modal,
  Form,
  Select,
  Input,
  Button,
  Space,
  InputNumber,
  Typography,
  message,
  Radio,
  Row,
  Col,
  Alert,
} from 'antd';
import { OsIcon } from '../../../../../components/OsIcon';
import { ReactComponent as CpuSvg } from '../../../../../assets/clouds/cpu.svg';
import { ReactComponent as MemSvg } from '../../../../../assets/clouds/mem.svg';
import { ReactComponent as DiskSvg } from '../../../../../assets/clouds/disk.svg';
import { ReactComponent as NicSvg } from '../../../../../assets/clouds/nic.svg';
import { createHarvesterVm } from '../../../../../services/harvesterApi';
import {
  initialWizardValues,
  constructVmPayload,
  generateUniqueVmId,
  parseSizeToGi,
} from '../../modals/VmCreateWizard/VmWizardUtils';
import {
  KUBE_OVN_FLAT_VPC,
  isFlatKubeOvnSubnetVpc,
} from '../../kube-ovn/lib/kubeOvnSubnetConstants';
import {
  pickDefaultStorageClassName,
  isSystemNamespace,
  isPublicNamespace,
  pickFirstNamespaceRecordByScenarioForOptions,
} from '../../../../../utils/harvesterUtils';

const PAAS_DISPLAY: Record<string, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  rocketmq: 'RocketMQ',
  kafka: 'Kafka',
};

export type RdsCreateModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  images: any[];
  storageClasses: any[];
  kubeSubnets: any[];
  harvesterNads?: any[];
  onCreated: () => void;
  /** 与镜像标签 tower.io/paas-type 一致，并写入新建实例 */
  paasType?: string;
  /** 可选命名空间列表（与 VM 向导一致）；租户时取首个非系统/非公共命名空间，避免固定 default 导致 403 */
  namespacesOptions?: string[];
  /** 与 namespacesOptions 对应的库存对象，用于 tower.io/scenario 默认选中 */
  namespaceRecords?: any[];
  isTenant?: boolean;
};

const SUBNET_TYPE_ANNOTATION = 'tower.io/subnet-type';
const SPEC_PRESETS = [
  { key: '2c4g', label: '2C/4G', cpu: 2, mem: 4 },
  { key: '4c8g', label: '4C/8G', cpu: 4, mem: 8 },
  { key: '8c16g', label: '8C/16G', cpu: 8, mem: 16 },
  { key: '16c32g', label: '16C/32G', cpu: 16, mem: 32 },
] as const;

function isKubeOvnFlatSubnet(s: any): boolean {
  const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] ?? '').trim().toLowerCase();
  return t === 'flat';
}

function subnetDisplayName(x: any): string {
  return String(x?.name || x?.metadata?.name || '').trim() || '-';
}

function subnetCidrBlock(x: any): string {
  return String(x?.spec?.cidrBlock ?? x?.spec?.cidr ?? x?.cidr ?? '').trim();
}

function resolveFlatSubnetPrimaryNic(
  subnetName: string,
  kubeSubnets: any[],
  nadOptions: { value: string }[],
) {
  let netName = subnetName;
  const subnet = (kubeSubnets || []).find((x: any) => {
    const nm = subnetDisplayName(x);
    return (
      nm === subnetName &&
      isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) &&
      isKubeOvnFlatSubnet(x)
    );
  });
  let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
  if (!subnetNs && subnet) {
    const provider = subnet?.provider || subnet?.spec?.provider;
    if (provider) {
      const parts = String(provider).split('.');
      if (parts.length >= 2) subnetNs = parts[parts.length - 2];
    }
  }
  if (subnetNs) {
    netName = `${subnetNs}/${subnetName}`;
  } else {
    const found = (nadOptions || []).find((x: any) => {
      const vv = String(x?.value || '');
      const parts = vv.split('/');
      const name = parts.length > 1 ? parts[1] : parts[0];
      return name === subnetName;
    });
    if (found?.value) netName = found.value;
  }
  return {
    type: 'managedtap',
    model: 'virtio',
    vpc: String(subnet?.spec?.vpc || subnet?.vpc || KUBE_OVN_FLAT_VPC).trim() || KUBE_OVN_FLAT_VPC,
    subnet: subnetName,
    name: netName,
  };
}

function resolveImageStorageClass(it: any, fallback?: string) {
  const sc = String(
    it?.storageClassName ||
      it?.spec?.storageClassName ||
      it?.metadata?.annotations?.['harvesterhci.io/storageClassName'] ||
      '',
  ).trim();
  return sc || (fallback ? String(fallback).trim() : undefined);
}

function generateDefaultRdsAlias() {
  const t = new Date();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  const h = String(t.getHours()).padStart(2, '0');
  const min = String(t.getMinutes()).padStart(2, '0');
  return `rds-${m}${d}-${h}${min}`;
}

function findImageByValue(images: any[], val: string) {
  return (images || []).find((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    const v = ns && name ? `${ns}/${name}` : name;
    return v === val;
  });
}

function getImageLabels(image: any): Record<string, any> {
  return (
    image?.metadata?.labels ||
    image?.labels ||
    image?.rawData?.metadata?.labels ||
    image?.raw?.metadata?.labels ||
    {}
  );
}

function readImagePaasType(image: any): string {
  return String(getImageLabels(image)['tower.io/paas-type'] || '').trim().toLowerCase();
}

/** 镜像标签 tower.io/paas-ver，如 5.7、8.0 */
function readImagePaasVer(image: any): string {
  return String(getImageLabels(image)['tower.io/paas-ver'] || '').trim();
}

function comparePaasVer(a: string, b: string): number {
  const pa = a.split(/[.\-_]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-_]/).map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return a.localeCompare(b);
}

function imageMinDiskGi(image: any): number {
  const raw = image?.spec?.virtualSize ?? image?.virtualSize ?? image?.status?.size ?? image?.size;
  const gi = parseSizeToGi(raw);
  return Math.max(1, gi || 10);
}

const RdsCreateModal: React.FC<RdsCreateModalProps> = ({
  open,
  onClose,
  cloudId,
  images = [],
  storageClasses = [],
  kubeSubnets = [],
  harvesterNads = [],
  onCreated,
  paasType = 'mysql',
  namespacesOptions = [],
  namespaceRecords = [],
  isTenant = false,
}) => {
  const paasKey = String(paasType || 'mysql').trim().toLowerCase();
  const paasLabel = PAAS_DISPLAY[paasKey] || paasKey.toUpperCase();

  const targetNamespace = useMemo(() => {
    const opts = (namespacesOptions || [])
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    if (!isTenant) {
      const preferred = pickFirstNamespaceRecordByScenarioForOptions(
        namespaceRecords,
        opts,
        'admin',
      );
      return preferred || 'default';
    }
    const business = opts.filter((n) => !isSystemNamespace(n) && !isPublicNamespace(n));
    const preferred = pickFirstNamespaceRecordByScenarioForOptions(
      namespaceRecords,
      business,
      'tenant',
    );
    return preferred || business[0] || '';
  }, [isTenant, namespacesOptions, namespaceRecords]);

  const namespaceReady = !isTenant || !!targetNamespace;
  const [form] = Form.useForm();
  const specPresetWatched = Form.useWatch('specPreset', form);
  const filterPaasTypeWatched = Form.useWatch('rdsPaasType', form);
  const filterPaasVerWatched = Form.useWatch('rdsPaasVer', form);
  const modalTypeKey = String(filterPaasTypeWatched ?? paasKey).trim().toLowerCase();
  const modalPaasLabel = PAAS_DISPLAY[modalTypeKey] || (modalTypeKey ? modalTypeKey.toUpperCase() : paasLabel);
  const showCustomCpuMem = specPresetWatched === 'custom';
  const [submitting, setSubmitting] = useState(false);
  const vmIdRef = useRef<string | null>(null);

  const defaultStorageClassName = useMemo(() => {
    return pickDefaultStorageClassName(storageClasses || []);
  }, [storageClasses]);

  const nadOptions = useMemo(
    () =>
      (harvesterNads || []).map((x: any) => {
        const name = x?.metadata?.name || x?.name;
        const ns = x?.metadata?.namespace || x?.namespace;
        return {
          label: `${name || '-'} (${ns || '-'})`,
          value: ns && name ? `${ns}/${name}` : (name || '-'),
        };
      }),
    [harvesterNads],
  );

  const flatSubnetOptions = useMemo(() => {
    return (kubeSubnets || [])
      .filter(
        (x: any) => isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) && isKubeOvnFlatSubnet(x)
      )
      .map((x: any) => {
        const n = subnetDisplayName(x);
        const alias = String(x?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
        const cidr = subnetCidrBlock(x);
        const shownName = alias || n;
        return {
          label: (
            <Space>
              <span>{shownName}</span>
              {cidr && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{cidr}</Typography.Text>}
            </Space>
          ),
          searchText: `${n} ${alias} ${cidr}`,
          value: n,
        };
      });
  }, [kubeSubnets]);

  /** 带 tower.io/paas-type 的镜像，作为 RDS 可选镜像目录 */
  const catalogImages = useMemo(
    () => (images || []).filter((x: any) => !!readImagePaasType(x)),
    [images],
  );

  const paasTypeOptions = useMemo(() => {
    const s = new Set<string>();
    catalogImages.forEach((img: any) => {
      const t = readImagePaasType(img);
      if (t) s.add(t);
    });
    return Array.from(s)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ value: k, label: PAAS_DISPLAY[k] || k }));
  }, [catalogImages]);

  const effectiveFilterType = String(filterPaasTypeWatched || paasKey || '')
    .trim()
    .toLowerCase();

  const paasVerOptions = useMemo(() => {
    const subset = catalogImages.filter((x: any) => readImagePaasType(x) === effectiveFilterType);
    const vers = new Set<string>();
    subset.forEach((img: any) => {
      const v = readImagePaasVer(img);
      if (v) vers.add(v);
    });
    const sorted = Array.from(vers).sort(comparePaasVer);
    return [
      { value: '', label: '全部版本' },
      ...sorted.map((v) => ({ value: v, label: v })),
    ];
  }, [catalogImages, effectiveFilterType]);

  const diskImages = useMemo(() => {
    const t = effectiveFilterType;
    if (!t) return [];
    let list = catalogImages.filter((x: any) => readImagePaasType(x) === t);
    const v = String(filterPaasVerWatched ?? '').trim();
    if (v) list = list.filter((x: any) => readImagePaasVer(x) === v);
    return list;
  }, [catalogImages, effectiveFilterType, filterPaasVerWatched]);

  const imageSelectOptions = useMemo(
    () =>
      diskImages.map((x: any) => {
        const name = x?.metadata?.name || x?.name;
        const ns = x?.metadata?.namespace || x?.namespace;
        const disp =
          x?.spec?.displayName ||
          getImageLabels(x)?.['harvesterhci.io/imageDisplayName'] ||
          name;
        return {
          label: (
            <Space>
              <OsIcon osName={disp || name} />
              {disp || '-'}
            </Space>
          ),
          labelString: disp || name,
          value: ns && name ? `${ns}/${name}` : name,
        };
      }),
    [diskImages],
  );

  useEffect(() => {
    if (!open) {
      form.resetFields();
      vmIdRef.current = null;
      return;
    }
    let cancelled = false;
    const ns = targetNamespace || 'default';
    generateUniqueVmId(cloudId, ns).then((id) => {
      if (cancelled) return;
      vmIdRef.current = id;
    });
    const defaultType =
      paasTypeOptions.some((o) => o.value === paasKey) ? paasKey : paasTypeOptions[0]?.value || paasKey;

    form.setFieldsValue({
      alias: generateDefaultRdsAlias(),
      specPreset: '2c4g',
      cpu: 2,
      memoryGi: 4,
      rdsPaasType: defaultType,
      rdsPaasVer: '',
      image: undefined,
      rootSizeGi: undefined,
      flatSubnet: undefined,
    });
    return () => {
      cancelled = true;
    };
  }, [open, form, cloudId, targetNamespace, paasKey, paasTypeOptions]);

  useEffect(() => {
    if (!open || flatSubnetOptions.length === 0) return;
    const cur = form.getFieldValue('flatSubnet');
    const valid = cur != null && String(cur).trim() !== '' && flatSubnetOptions.some((o) => o.value === cur);
    if (valid) return;
    form.setFieldValue('flatSubnet', flatSubnetOptions[0].value);
  }, [open, flatSubnetOptions, form]);

  useEffect(() => {
    if (!open || imageSelectOptions.length === 0) return;
    const cur = form.getFieldValue('image');
    const valid = cur != null && String(cur).trim() !== '' && imageSelectOptions.some((o) => o.value === cur);
    if (valid) return;
    const firstVal = imageSelectOptions[0].value;
    const it = findImageByValue(images || [], String(firstVal));
    form.setFieldsValue({
      image: firstVal,
      rootSizeGi: imageMinDiskGi(it),
    });
  }, [open, imageSelectOptions, form, images]);

  const applyPreset = (key: string) => {
    if (key === 'custom') return;
    const preset = SPEC_PRESETS.find((item) => item.key === key);
    if (preset) {
      form.setFieldsValue({ cpu: preset.cpu, memoryGi: preset.mem });
    }
  };

  const applyImageDerivedFieldsToForm = (imageValue: string) => {
    const it = findImageByValue(images || [], String(imageValue));
    form.setFieldValue('rootSizeGi', imageMinDiskGi(it));
  };

  const specPresetButtonOptions = useMemo(
    () => [
      ...SPEC_PRESETS.map((item) => ({ label: item.label, value: item.key })),
      { label: '自定义', value: 'custom' },
    ],
    [],
  );

  const handleOk = async () => {
    if (!namespaceReady) {
      message.warning('当前账号未分配可用的业务命名空间，无法创建实例');
      return;
    }
    try {
      const values = await form.validateFields();
      const aliasRaw = String(values.alias || '').trim();
      const displayName = aliasRaw || generateDefaultRdsAlias();
      const memGi = Number(values.memoryGi) || 4;
      const base = initialWizardValues(memGi, displayName, cloudId);
      
      const subnetName = String(values.flatSubnet || '').trim();
      const primaryNic = subnetName
        ? resolveFlatSubnetPrimaryNic(subnetName, kubeSubnets || [], nadOptions)
        : undefined;

      const it = findImageByValue(images || [], values.image);
      const minDisk = imageMinDiskGi(it);
      const rootGi = Number(values.rootSizeGi);
      if (rootGi < minDisk) {
        Modal.error({ title: '无法创建', content: `系统盘容量不能小于镜像所需最小值 ${minDisk} GiB` });
        return;
      }

      const typeForVm = String(values.rdsPaasType || paasKey || '')
        .trim()
        .toLowerCase();
      const paasLabelSubmit = PAAS_DISPLAY[typeForVm] || typeForVm.toUpperCase();

      const v: any = {
        ...base,
        namespace: targetNamespace,
        name: displayName,
        image: values.image,
        storageClassName: resolveImageStorageClass(it, defaultStorageClassName),
        cpu: Number(values.cpu) || 2,
        memory: `${memGi}Gi`,
        primaryNic,
        netMode: 'flat_subnet',
        hostMode: 'auto',
        rootSize: rootGi,
        rootSourceType: 'image',
        rootStorageClass: resolveImageStorageClass(it, defaultStorageClassName),
        rootBus: 'virtio',
        rootDeviceType: 'disk',
        bootUseEfi: false,
        extraDisks: [],
        kubeVpcNetwork: KUBE_OVN_FLAT_VPC,
        networks: primaryNic ? [primaryNic] : [],
        userData: '',
        networkData: '',
        runStrategy: 'RerunOnFailure',
      };

      setSubmitting(true);
      const vmId = vmIdRef.current || (await generateUniqueVmId(cloudId, targetNamespace));
      vmIdRef.current = vmId;

      const payload = constructVmPayload({
        v,
        memGi,
        hostModeState: 'auto',
        selectedNodeName: null,
        gpuResources: [],
        selectedGpu: null,
        capabilities: undefined,
        isArm64: false,
        vmId,
      });

      // ==========================================
      // 核心注入: 为创建的实例打上 RDS 的标签（顶层 + spec.template，与列表 SafeRead 一致）
      // ==========================================
      const formPaasVer = String(values.rdsPaasVer || '').trim();
      const imgPaasVer = readImagePaasVer(it);
      const verForVm = imgPaasVer || formPaasVer;

      if (!payload.metadata.labels) payload.metadata.labels = {};
      payload.metadata.labels['tower.io/rds'] = 'true';
      payload.metadata.labels['tower.io/paas-type'] = typeForVm;
      if (verForVm) {
        payload.metadata.labels['tower.io/paas-ver'] = verForVm;
      }

      const tplMeta = payload.spec?.template?.metadata;
      if (tplMeta) {
        if (!tplMeta.labels) tplMeta.labels = {};
        tplMeta.labels['tower.io/rds'] = 'true';
        tplMeta.labels['tower.io/paas-type'] = typeForVm;
        if (verForVm) {
          tplMeta.labels['tower.io/paas-ver'] = verForVm;
        }
      }

      await createHarvesterVm(cloudId, payload);
      message.success(`${paasLabelSubmit} 实例创建成功`);
      await Promise.resolve(onCreated());
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      Modal.error({ title: '创建失败', content: e?.message || String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`创建 ${modalPaasLabel} 实例`}
      open={open}
      onCancel={onClose}
      width={600}
      centered
      maskClosable={false}
      footer={null}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        {isTenant && !namespaceReady ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="未找到可用的业务命名空间"
            description="租户不允许在 default 等系统/公共命名空间创建资源。请由管理员在 UserSpace 中为本租户分配命名空间后再创建云数据库实例。"
          />
        ) : null}
        {catalogImages.length === 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="暂无可选 RDS 镜像"
            description="请为镜像配置标签 tower.io/paas-type（可选 tower.io/paas-ver 用于版本筛选）。"
          />
        ) : null}
        <Form.Item name="alias" label="云数据库名称" rules={[{ required: true, message: '请输入实例名称' }]}>
          <Input placeholder="已自动生成，可修改" allowClear maxLength={60} />
        </Form.Item>

        <Form.Item name="specPreset" label="选择规格">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            block
            options={specPresetButtonOptions}
            onChange={(e) => applyPreset(String(e.target.value))}
            style={{ display: 'flex', flexWrap: 'wrap' }}
          />
        </Form.Item>

        <div style={{ display: showCustomCpuMem ? 'block' : 'none' }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cpu" label="vCPU" rules={[{ required: true, message: '请输入 CPU' }]}>
                <InputNumber
                  min={1}
                  max={128}
                  style={{ width: '100%' }}
                  onChange={() => form.setFieldValue('specPreset', 'custom')}
                  prefix={
                    <Space size={6} align="center">
                      <CpuSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />
                      <span>vCPU</span>
                    </Space>
                  }
                  suffix="核"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="memoryGi" label="内存" rules={[{ required: true, message: '请输入内存' }]}>
                <InputNumber
                  min={1}
                  max={512}
                  style={{ width: '100%' }}
                  onChange={() => form.setFieldValue('specPreset', 'custom')}
                  prefix={
                    <Space size={6} align="center">
                      <MemSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />
                      <span>内存</span>
                    </Space>
                  }
                  suffix="GiB"
                />
              </Form.Item>
            </Col>
          </Row>
        </div>

        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="rdsPaasType"
              label="RDS 类型"
              rules={[{ required: true, message: '请选择 RDS 类型' }]}
            >
              <Select
                placeholder="按镜像标签 tower.io/paas-type"
                options={paasTypeOptions}
                disabled={paasTypeOptions.length === 0}
                onChange={() => {
                  form.setFieldsValue({ rdsPaasVer: '', image: undefined, rootSizeGi: undefined });
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="rdsPaasVer" label="RDS 版本">
              <Select
                placeholder="全部版本"
                options={paasVerOptions}
                disabled={paasTypeOptions.length === 0 || !effectiveFilterType}
                onChange={() => {
                  form.setFieldsValue({ image: undefined, rootSizeGi: undefined });
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12} align="top">
          <Col xs={24} md={14}>
            <Form.Item name="image" label="选择镜像" rules={[{ required: true, message: '请选择镜像' }]}>
              <Select
                showSearch
                placeholder={
                  diskImages.length === 0
                    ? '请先选择类型与版本，或当前无匹配镜像'
                    : '请选择镜像'
                }
                options={imageSelectOptions}
                optionFilterProp="labelString"
                disabled={imageSelectOptions.length === 0}
                onChange={(val) => applyImageDerivedFieldsToForm(String(val))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item
              name="rootSizeGi"
              label="系统盘容量"
              rules={[
                { required: true, message: '请输入系统盘容量' },
                {
                  validator: (_: any, value: any) => {
                    const it = findImageByValue(images || [], form.getFieldValue('image'));
                    const minGi = imageMinDiskGi(it);
                    if (value == null || value === '') return Promise.resolve();
                    const num = Number(value);
                    if (Number.isNaN(num) || num < minGi) {
                      return Promise.reject(new Error(`不能小于 ${minGi} GiB`));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber
                min={1}
                max={2048}
                style={{ width: '100%' }}
                prefix={<DiskSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />}
                suffix="GiB"
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="flatSubnet" label="选择网络" rules={[{ required: true, message: '请选择网络' }]}>
          <Select
            showSearch
            placeholder="选择数据库子网"
            options={flatSubnetOptions}
            disabled={flatSubnetOptions.length === 0}
            prefix={<NicSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />}
            filterOption={(input, option) => {
              const q = String(input ?? '').trim().toLowerCase();
              if (!q) return true;
              return String(option?.searchText || '').toLowerCase().includes(q);
            }}
          />
        </Form.Item>
      </Form>

      <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 24 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" loading={submitting} onClick={handleOk} disabled={!namespaceReady}>
          立即创建
        </Button>
      </Space>
    </Modal>
  );
};

export default RdsCreateModal;
