/**
 * Cloudmap 资源池「快速创建」使用的极简创建虚拟机弹窗。
 * 命名空间固定 default（不展示）；网络固定为 Kube-OVN 扁平子网，接口类型固定为 managedtap（与创建向导扁平子网一致）。
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Modal,
  Form,
  Select,
  Input,
  Button,
  Space,
  Tag,
  InputNumber,
  Typography,
  message,
  Radio,
  Row,
  Col,
} from 'antd';
import type { RadioChangeEvent } from 'antd';
import { OsIcon } from '../../../../../../components/OsIcon';
import { ReactComponent as CpuSvg } from '../../../../../../assets/clouds/cpu.svg';
import { ReactComponent as MemSvg } from '../../../../../../assets/clouds/mem.svg';
import { ReactComponent as DiskSvg } from '../../../../../../assets/clouds/disk.svg';
import { ReactComponent as NicSvg } from '../../../../../../assets/clouds/nic.svg';
import { createHarvesterVm } from '../../../../../../services/harvesterApi';
import {
  initialWizardValues,
  validateImageSize,
  constructVmPayload,
  generateUniqueVmId,
  parseSizeToGi,
} from './VmCreateWizard/VmWizardUtils';
import {
  KUBE_OVN_FLAT_VPC,
  isFlatKubeOvnSubnetVpc,
} from '../../kube-ovn/lib/kubeOvnSubnetConstants';
import {
  isHarvesterVmImageReady,
  isSystemNamespace,
  isSystemStorageClass,
  pickDefaultStorageClassName,
  pickFirstNamespaceRecordByScenario,
} from '../../../../../../utils/harvesterUtils';
export type SimpleVmCreateModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  images: any[];
  storageClasses: any[];
  capabilities: any | null;
  kubeSubnets: any[];
  harvesterNads?: any[];
  onReloadSubnets?: () => void;
  onReloadImages?: () => void;
  /** 用于别名重复校验（与同命名空间已有 VM 的 tower.io/alias） */
  existingVms?: any[];
  onCreated: () => void | Promise<void>;
  /** 命名空间库存对象（metadata.labels.tower.io/scenario） */
  namespaceRecords?: any[];
  /** 租户控制台页头当前命名空间；优先于按 scenario 推断，避免落到 default 导致无权创建 */
  workspaceNamespace?: string;
  /** 租户创建时仅选 tenant 场景；管理员选 admin；无匹配时回退 default */
  isTenant?: boolean;
};

const SUBNET_TYPE_ANNOTATION = 'tower.io/subnet-type';

const SPEC_PRESETS = [
  { key: '2c4g', label: '2C/4G', cpu: 2, mem: 4 },
  { key: '4c8g', label: '4C/8G', cpu: 4, mem: 8 },
  { key: '8c16g', label: '8C/16G', cpu: 8, mem: 16 },
  { key: '16c32g', label: '16C/32G', cpu: 16, mem: 32 },
  { key: '32c64g', label: '32C/64G', cpu: 32, mem: 64 },
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
    try {
      const found = (nadOptions || []).find((x: any) => {
        const vv = String(x?.value || '');
        const parts = vv.split('/');
        const name = parts.length > 1 ? parts[1] : parts[0];
        return name === subnetName;
      });
      if (found) netName = found.value;
    } catch {
      /* ignore */
    }
  }
  return {
    type: 'managedtap',
    model: 'virtio',
    vpc: String(subnet?.spec?.vpc || subnet?.vpc || KUBE_OVN_FLAT_VPC).trim() || KUBE_OVN_FLAT_VPC,
    subnet: subnetName,
    name: netName,
  };
}

function resolveImageKind(img: any): 'iso' | 'disk' | 'unknown' {
  const labels = img?.metadata?.labels || {};
  const typeLabel = String(labels['harvesterhci.io/image-type'] || '').toLowerCase();
  if (typeLabel === 'iso') return 'iso';
  if (['raw_qcow2', 'qcow2', 'raw'].includes(typeLabel)) return 'disk';
  const diskFormat = String(img?.spec?.diskFormat || img?.diskFormat || '').toLowerCase();
  if (diskFormat === 'iso') return 'iso';
  if (['qcow2', 'raw'].includes(diskFormat)) return 'disk';
  const disp = String(
    labels['harvesterhci.io/imageDisplayName'] || img?.metadata?.name || img?.name || '',
  ).toLowerCase();
  if (/\.(iso)$/.test(disp)) return 'iso';
  if (/\.(qcow2|img|raw)$/.test(disp)) return 'disk';
  return 'unknown';
}

function findImageByValue(images: any[], val: string) {
  return (images || []).find((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    const v = ns && name ? `${ns}/${name}` : name;
    return v === val;
  });
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

function toBooleanStrict(v: any, fallback = false): boolean {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  }
  if (typeof v === 'number') {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return fallback;
}

/** 系统盘最小 GiB（来自镜像 virtualSize/size，与向导 StepDisks 一致） */
function imageMinDiskGi(it: any): number {
  if (!it) return 10;
  const raw = (it as any)?.spec?.virtualSize ?? (it as any)?.virtualSize ?? (it as any)?.size;
  const gi = parseSizeToGi(raw);
  return Math.max(1, gi || 10);
}

/** 云主机显示名默认值（每次打开弹窗重新生成；提交时空值仍用同一规则兜底） */
function generateDefaultVmAlias() {
  return `vm-${Math.random().toString(36).slice(2, 6)}-${Date.now().toString(36).slice(-4)}`;
}

/** 选中镜像后回填系统盘容量与启动相关字段（与向导 StepDisks 一致） */
function applyImageDerivedFieldsToForm(form: any, imageList: any[], imageValue: string) {
  const it = findImageByValue(imageList, String(imageValue));
  const minGi = imageMinDiskGi(it);
  const dispName = String(
    it?.spec?.displayName ||
      it?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
      it?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
      it?.metadata?.annotations?.['field.cattle.io/displayName'] ||
      it?.displayName ||
      it?.name ||
      '',
  );
  const needEfi = /windows|win|uefi/.test(dispName.toLowerCase());
  const isWindows = /windows|win/.test(dispName.toLowerCase());
  try {
    form.setFieldsValue({
      rootSizeGi: minGi,
      bootUseEfi: needEfi,
      rootBus: isWindows ? 'sata' : 'virtio',
      rootDeviceType: 'disk',
    });
  } catch {
    /* ignore */
  }
}

const SimpleVmCreateModal: React.FC<SimpleVmCreateModalProps> = ({
  open,
  onClose,
  cloudId,
  images,
  storageClasses,
  capabilities,
  kubeSubnets,
  harvesterNads = [],
  onReloadSubnets,
  onReloadImages,
  existingVms = [],
  onCreated,
  namespaceRecords = [],
  workspaceNamespace,
  isTenant = false,
}) => {
  const [form] = Form.useForm();
  const specPresetWatched = Form.useWatch('specPreset', form);
  const showCustomCpuMem = specPresetWatched === 'custom';
  const [submitting, setSubmitting] = useState(false);
  const [diskBootAdvancedOpen, setDiskBootAdvancedOpen] = useState(false);
  const vmIdRef = useRef<string | null>(null);

  const defaultStorageClassName = useMemo(
    () => pickDefaultStorageClassName(storageClasses),
    [storageClasses],
  );

  /** 与创建向导 StepDisks 一致：下拉中排除系统/内部存储类 */
  const userSelectableStorageClassOptions = useMemo(
    () =>
      (storageClasses || [])
        .filter((x: any) => !isSystemStorageClass(String(x?.metadata?.name || x?.name || '')))
        .map((x: any) => {
          const n = String(x?.metadata?.name || x?.name || '').trim();
          const isDef = !!n && n === defaultStorageClassName;
          return {
            label: isDef ? (
              <Space size={6}>
                <span>{n}</span>
                <Tag color="blue">默认</Tag>
              </Space>
            ) : (
              n
            ),
            value: n,
          };
        }),
    [storageClasses, defaultStorageClassName],
  );

  const nadOptions = useMemo(
    () =>
      (harvesterNads || []).map((x: any) => {
        const name = x?.metadata?.name || x?.name;
        const ns = x?.metadata?.namespace || x?.namespace;
        let type = '';
        let vlan: any;
        try {
          const cfg = JSON.parse(x?.spec?.config || '{}');
          type = String(cfg?.type || '').toLowerCase();
          vlan = cfg?.vlan;
        } catch {
          /* ignore */
        }
        const tag = type || '-';
        const labelBase = `${name || '-'} (${ns || '-'})`;
        const label = vlan ? `${labelBase} · ${tag} · VLAN ${vlan}` : `${labelBase} · ${tag}`;
        return {
          label,
          value: ns && name ? `${ns}/${name}` : (name || '-'),
        };
      }),
    [harvesterNads],
  );

  const flatSubnetOptions = useMemo(() => {
    return (kubeSubnets || [])
      .filter(
        (x: any) => isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) && isKubeOvnFlatSubnet(x),
      )
      .map((x: any) => {
        const n = subnetDisplayName(x);
        const alias = String(x?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
        const vpcDisp =
          String(x?.spec?.vpc || x?.vpc || KUBE_OVN_FLAT_VPC).trim() || KUBE_OVN_FLAT_VPC;
        const cidr = subnetCidrBlock(x);
        // 展示层不暴露 metadata.name（仍用作 value），优先展示别名；网段用 Tag
        const shownName = alias || n;
        const shownVpc = alias ? '' : ` (${vpcDisp})`;
        const titleLine = `${shownName}${shownVpc}`.trim();
        const searchText = [titleLine, alias, n, vpcDisp, cidr].filter(Boolean).join(' ').toLowerCase();
        return {
          value: n,
          searchText,
          label: (
            <Space size={6} wrap>
              <span>{titleLine}</span>
              {cidr ? <Tag color="blue">{cidr}</Tag> : null}
            </Space>
          ),
        };
      });
  }, [kubeSubnets]);

  /** 按 Subnet metadata.name 缓存其 CIDR 段（用于快速创建网络选择展示/回填） */
  const subnetIpSegmentCacheRef = useRef<Record<string, string>>({});
  const subnetIpSegmentByName = useMemo(() => {
    const m: Record<string, string> = {};
    (kubeSubnets || []).forEach((x: any) => {
      const name = String(x?.metadata?.name ?? x?.name ?? '').trim();
      if (!name) return;
      const cidr = subnetCidrBlock(x);
      if (!cidr) return;
      m[name] = cidr;
    });
    subnetIpSegmentCacheRef.current = { ...subnetIpSegmentCacheRef.current, ...m };
    return subnetIpSegmentCacheRef.current;
  }, [kubeSubnets]);
  const selectedFlatSubnet = Form.useWatch('flatSubnet', form);
  const selectedFlatSubnetSegment = useMemo(() => {
    const n = String(selectedFlatSubnet ?? '').trim();
    if (!n) return '';
    return subnetIpSegmentByName[n] || '';
  }, [selectedFlatSubnet, subnetIpSegmentByName]);

  const targetNamespace = useMemo(() => {
    const ws = String(workspaceNamespace || '').trim();
    if (isTenant && ws) return ws;
    const picked = pickFirstNamespaceRecordByScenario(
      namespaceRecords,
      isTenant ? 'tenant' : 'admin',
    );
    if (picked) return picked;
    if (isTenant) {
      for (const r of namespaceRecords || []) {
        const name = String(r?.metadata?.name || r?.name || '').trim();
        if (name && !isSystemNamespace(name)) return name;
      }
    }
    return 'default';
  }, [namespaceRecords, isTenant, workspaceNamespace]);

  const diskImages = useMemo(
    () =>
      (images || []).filter(
        (x: any) => resolveImageKind(x) !== 'iso' && isHarvesterVmImageReady(x),
      ),
    [images],
  );

  const imageSelectOptions = useMemo(
    () =>
      diskImages.map((x: any) => {
        const name = x?.metadata?.name || x?.name;
        const ns = x?.metadata?.namespace || x?.namespace;
        const disp =
          x?.spec?.displayName ||
          x?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
          x?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
          x?.metadata?.annotations?.['field.cattle.io/displayName'] ||
          x?.displayName ||
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
    generateUniqueVmId(cloudId, targetNamespace).then((id) => {
      if (cancelled) return;
      vmIdRef.current = id;
    });
    form.setFieldsValue({
      alias: generateDefaultVmAlias(),
      specPreset: '2c4g',
      cpu: 2,
      memoryGi: 4,
      image: undefined,
      rootSizeGi: undefined,
      flatSubnet: undefined,
      dataDisks: [],
      bootUseEfi: false,
      rootBus: 'virtio',
      rootDeviceType: 'disk',
    });
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, form, targetNamespace]);

  useEffect(() => {
    if (!open || flatSubnetOptions.length === 0) return;
    const cur = form.getFieldValue('flatSubnet');
    const valid =
      cur != null &&
      String(cur).trim() !== '' &&
      flatSubnetOptions.some((o) => o.value === cur);
    if (valid) return;
    form.setFieldValue('flatSubnet', flatSubnetOptions[0].value);
  }, [open, flatSubnetOptions, form]);

  useEffect(() => {
    if (!open || imageSelectOptions.length === 0) return;
    const cur = form.getFieldValue('image');
    const valid =
      cur != null &&
      String(cur).trim() !== '' &&
      imageSelectOptions.some((o) => o.value === cur);
    if (valid) return;
    const firstVal = imageSelectOptions[0].value;
    form.setFieldValue('image', firstVal);
    applyImageDerivedFieldsToForm(form, images, String(firstVal));
  }, [open, imageSelectOptions, form, images]);

  const applyPreset = (key: string) => {
    if (key === 'custom') return;
    const p = SPEC_PRESETS.find((x) => x.key === key);
    if (p) form.setFieldsValue({ cpu: p.cpu, memoryGi: p.mem });
  };

  const isArm64 = useMemo(() => {
    const arch = String(capabilities?.architecture || '').toLowerCase();
    return arch === 'arm64' || arch === 'aarch64';
  }, [capabilities]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const aliasRaw = String(values.alias || '').trim();
      const displayName = aliasRaw || generateDefaultVmAlias();
      const memGi = Number(values.memoryGi) || 4;
      const base = initialWizardValues(memGi, displayName, cloudId);
      const subnetName = String(values.flatSubnet || '').trim();
      const primaryNic = resolveFlatSubnetPrimaryNic(subnetName, kubeSubnets || [], nadOptions);
      const it = findImageByValue(images || [], values.image);
      const minDisk = imageMinDiskGi(it);
      const rootGi = Number(values.rootSizeGi);
      if (rootGi < minDisk) {
        Modal.error({ title: '无法创建', content: `系统盘容量不能小于镜像所需最小值 ${minDisk} GiB` });
        return;
      }

      const dispName = String(
        it?.spec?.displayName ||
          it?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
          it?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
          it?.metadata?.annotations?.['field.cattle.io/displayName'] ||
          it?.displayName ||
          it?.name ||
          '',
      );
      const needEfi = /windows|win|uefi/.test(dispName.toLowerCase());
      const resolvedStorageClass = resolveImageStorageClass(it, defaultStorageClassName);
      const bootUseEfi = toBooleanStrict(values.bootUseEfi, needEfi);

      const v: any = {
        ...base,
        namespace: targetNamespace,
        name: displayName,
        image: values.image,
        storageClassName: resolvedStorageClass,
        cpu: Number(values.cpu) || 2,
        memory: `${memGi}Gi`,
        rootSize: String(rootGi),
        primaryNic,
        netMode: 'flat_subnet',
        hostMode: 'auto',
        gpuMode: 'none',
        bootUseEfi,
        rootBus: String(values.rootBus || 'virtio'),
        rootDeviceType: String(values.rootDeviceType || 'disk'),
      };

      // 数据盘（快速创建）：映射到向导通用 extraDisks
      const rawDataDisks = Array.isArray(values.dataDisks) ? values.dataDisks : [];
      const extraDisks = rawDataDisks
        .map((d: any, idx: number) => {
          const sizeGi = Number(d?.sizeGi);
          if (!Number.isFinite(sizeGi) || sizeGi <= 0) return null;
          const sc = String(d?.storageClassName ?? '').trim();
          const bus = String(d?.bus ?? '').trim();
          return {
            name: `data-${idx + 1}`,
            sourceType: 'new',
            size: String(Math.ceil(sizeGi)),
            storageClassName: sc || resolvedStorageClass || defaultStorageClassName,
            bus: bus || 'virtio',
            type: 'disk',
            volumeMode: 'Block',
          };
        })
        .filter(Boolean);
      if (extraDisks.length > 0) v.extraDisks = extraDisks;

      const sizeErr = validateImageSize(v, images || []);
      if (sizeErr) {
        Modal.error({ title: '无法创建', content: sizeErr });
        return;
      }

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
        capabilities: capabilities || undefined,
        isArm64,
        vmId,
      });

      await createHarvesterVm(cloudId, payload);
      message.success('创建成功');
      await Promise.resolve(onCreated());
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      Modal.error({ title: '创建失败', content: e?.message || String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const specPresetButtonOptions = useMemo(
    () => [
      ...SPEC_PRESETS.map((p) => ({ label: p.label, value: p.key })),
      { label: '自定义', value: 'custom' },
    ],
    [],
  );

  return (
    <Modal
      title="创建云主机"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      centered
      width={560}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="alias"
          label="云主机名称"
          rules={[
            {
              validator: async (_: any, value: any) => {
                const name = String(value || '').trim();
                if (!name) return;
                const list = Array.isArray(existingVms) ? existingVms : [];
                const getVmNamespace = (vm: any) => {
                  const direct = vm?.namespace || vm?.metadata?.namespace;
                  if (direct) return String(direct).trim();
                  const iid = vm?.InstanceId || vm?.id || vm?.metadata?.name;
                  const s = String(iid || '').trim();
                  if (s.includes('/')) return s.split('/')[0].trim();
                  return '';
                };
                const getVmAlias = (vm: any) =>
                  String(
                    vm?.metadata?.annotations?.['tower.io/alias'] || vm?.annotations?.['tower.io/alias'] || '',
                  ).trim();
                const dup = list.some((vm: any) => {
                  const vmNs = getVmNamespace(vm);
                  if (!vmNs || vmNs !== targetNamespace) return false;
                  const al = getVmAlias(vm);
                  if (!al) return false;
                  return al === name;
                });
                if (dup) throw new Error('已有相同名称的虚拟机');
              },
            },
          ]}
        >
          <Input placeholder="已自动生成，可修改" allowClear />
        </Form.Item>

        <Form.Item name="specPreset" label="选择规格">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            block
            options={specPresetButtonOptions}
            onChange={(e: RadioChangeEvent) => {
              applyPreset(String(e.target.value));
            }}
            style={{ display: 'flex', flexWrap: 'wrap' }}
          />
        </Form.Item>
        <div style={{ display: showCustomCpuMem ? 'block' : 'none'}}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item 
                name="cpu" 
                label="vCPU" 
                rules={[{ required: true, message: '请输入 CPU' }]}
              >
                <InputNumber
                  min={1}
                  max={256}
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
              <Form.Item
                name="memoryGi" 
                label="内存"
                rules={[{ required: true, message: '请输入内存' }]}
              >
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

        <Row gutter={12} align="top">
          <Col xs={24} md={14}>
            <Form.Item name="image" label="选择镜像" rules={[{ required: true, message: '请选择镜像' }]}>
              <Select
                showSearch
                placeholder="选择镜像"
                optionFilterProp="labelString"
                options={imageSelectOptions}
                disabled={imageSelectOptions.length === 0}
                onOpenChange={(o) => {
                  if (o && onReloadImages) onReloadImages();
                }}
                onChange={(val) => applyImageDerivedFieldsToForm(form, images, String(val))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item noStyle shouldUpdate={(p, c) => p.image !== c.image}>
              {() => {
                const imgVal = form.getFieldValue('image');
                const it = findImageByValue(images || [], imgVal);
                const minGi = imageMinDiskGi(it);
                return (
                  <Form.Item
                    name="rootSizeGi"
                    label="系统盘容量"
                    rules={[
                      { required: true, message: '请输入系统盘容量' },
                      {
                        validator: (_: any, v: any) => {
                          if (v == null || v === '') return Promise.resolve();
                          const num = Number(v);
                          if (Number.isNaN(num) || num < minGi) {
                            return Promise.reject(new Error(`不能小于 ${minGi} GiB`));
                          }
                          return Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <InputNumber
                      min={minGi}
                      max={2048}
                      style={{ width: '100%' }}
                      disabled={!imgVal}
                      prefix={
                        <DiskSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />
                      }
                      suffix="GiB"
                    />
                  </Form.Item>
                );
              }}
            </Form.Item>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item label="启动方式" colon={false}>
              <Button
                block
                style={{ height: '32px' }}
                onClick={() => setDiskBootAdvancedOpen((v) => !v)}
              >
                {diskBootAdvancedOpen ? '自定义' : '自动配置'}
              </Button>
            </Form.Item>
          </Col>
        </Row>

        {diskBootAdvancedOpen ? (
          <Row gutter={12} align="top">
            <Col xs={24} md={14}>
              <Form.Item name="rootBus" label="系统盘总线" rules={[{ required: true, message: '请选择系统盘总线' }]}>
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  block
                  options={[
                    { label: 'VirtIO', value: 'virtio' },
                    { label: 'SATA', value: 'sata' },
                    { label: 'SCSI', value: 'scsi' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="bootUseEfi" label="启动方式" rules={[{ required: true, message: '请选择启动方式' }]}>
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  block
                  options={[
                    { label: 'Legacy', value: false },
                    { label: 'UEFI', value: true },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        ) : null}

        <Form.Item name="flatSubnet" label="选择网络" rules={[{ required: true, message: '请选择网络' }]}>
          <Select
            showSearch
            placeholder="选择扁平子网"
            options={flatSubnetOptions}
            filterOption={(input, option) => {
              const v = String((option as { value?: string })?.value ?? '');
              const hit = flatSubnetOptions.find((o) => o.value === v);
              const raw = String((hit as { searchText?: string })?.searchText ?? '').toLowerCase();
              const q = String(input ?? '').trim().toLowerCase();
              if (!q) return true;
              return raw.includes(q);
            }}
            disabled={flatSubnetOptions.length === 0}
            prefix={<NicSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />}
            onOpenChange={(o) => {
              if (o && onReloadSubnets) onReloadSubnets();
            }}
          />
        </Form.Item>


        <Form.Item label="数据盘（可选）" colon={false}>
          <Form.List name="dataDisks">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={12} align="top">
                    <Col xs={24} md={14}>
                      <Form.Item {...field} name={[field.name, 'storageClassName']} style={{ marginBottom: 10 }}>
                        <Select
                          allowClear
                          placeholder={`存储类（默认 ${defaultStorageClassName || 'longhorn'}）`}
                          options={userSelectableStorageClassOptions}
                          prefix="存储池"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'sizeGi']}
                        rules={[{ required: true, message: '请输入容量' }]}
                        style={{ marginBottom: 10 }}
                      >
                        <InputNumber min={1} max={8192} style={{ width: '100%' }}                       prefix={
                        <Space size={6} align="center">
                      <DiskSvg width={16} height={16} style={{ display: 'block', fill: '#1890ff' }} />
                    </Space>
                      } suffix="GiB" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4}>
                      <Button danger block onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Col>
                  </Row>
                ))}
                <Button
                  type="link"
                  style={{ padding: 0 }}
                  onClick={() =>
                    add({
                      sizeGi: 20,
                      storageClassName: defaultStorageClassName || 'longhorn',
                    })
                  }
                >
                  + 添加数据盘
                </Button>
              </>
            )}
          </Form.List>
        </Form.Item>
      </Form>

      {flatSubnetOptions.length === 0 && (
        <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
          暂无可用扁平子网，请检查 Kube-OVN 与同步状态。
        </Typography.Text>
      )}
      {imageSelectOptions.length === 0 && (
        <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
          暂无可选磁盘镜像。
        </Typography.Text>
      )}

      <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" loading={submitting} onClick={handleOk}>
          创建
        </Button>
      </Space>
    </Modal>
  );
};

export default SimpleVmCreateModal;
