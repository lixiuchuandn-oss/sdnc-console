import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, InputNumber, Select, Input, Space, message, Tabs, Divider, Switch, Card, Radio, Row, Col, Table, Button } from 'antd';
import { SlidersOutlined, SettingOutlined, DatabaseOutlined, RobotOutlined, AppstoreOutlined, HddOutlined, PlusOutlined, DeleteOutlined, GlobalOutlined, GatewayOutlined } from '@ant-design/icons';
import { updateHarvesterVmSpec, fetchHarvesterStorageClasses, createHarvesterVolume, attachHarvesterVolumeToVm, attachHarvesterVolumeToVmByName, updateHarvesterVolume, detachHarvesterVolumeFromVm, fetchHarvesterImages, createHarvesterVm, deleteCloudProviderEcs, fetchHarvesterGpuResources } from '../../../../services/api';

type Props = {
  open: boolean;
  cloudId: string;
  record: any | null;
  onClose: () => void;
  onOk: () => void;
};

const VmReconfigureModal: React.FC<Props> = ({ open, cloudId, record, onClose, onOk }) => {
  const [form] = Form.useForm();
  const [tab, setTab] = useState<string>('inst');
  const [instChoice, setInstChoice] = useState<'spec'|'cpuAdv'|'memAdv'|'gpu'>('spec');
  const [scs, setScs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [gpuResources, setGpuResources] = useState<any[]>([]);
  const [selectedGpuKey, setSelectedGpuKey] = useState<string | null>(null);
  const [imageChoice, setImageChoice] = useState<'changeOs'|'expandSystemDisk'>('expandSystemDisk');
  const [storageChoice, setStorageChoice] = useState<'add'|'expand'|'remove'>('add');
  const [networkChoice, setNetworkChoice] = useState<'mainNic'|'auxNic'>('mainNic');
  useEffect(() => { (async()=>{ try{ const res=await fetchHarvesterStorageClasses(cloudId); const items = Array.isArray(res?.data?.items)?res.data.items:[]; setScs(items);}catch{} })(); }, [cloudId]);
  useEffect(() => { (async()=>{ try{ const res=await fetchHarvesterImages(cloudId); const items = Array.isArray(res?.data?.items)?res.data.items:[]; setImages(items);}catch{} })(); }, [cloudId]);
  useEffect(() => { (async()=>{ try{ const res=await fetchHarvesterGpuResources(cloudId); const items = Array.isArray(res?.data?.items)?res.data.items:(Array.isArray(res?.items)?res.items:[]); setGpuResources(items);}catch{} })(); }, [cloudId]);
  useEffect(() => {
    if (!record) return;
    const cpu = record?.Extra?.CPU;
    const mem = record?.Extra?.Memory;
    form.setFieldsValue({ cpu, memory: mem });
  }, [record, form]);
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const iid = String(record?.InstanceId || record?.id || '');
      if (!iid || !iid.includes('/')) { message.error('实例ID缺失'); return; }
      const ns = iid.split('/')[0];
      const name = iid.split('/')[1];
      if (tab === 'inst') {
        const payload: any = {};
        if (instChoice === 'spec') {
          const vals = await form.validateFields(['cpu','memory']);
          payload.cpu = vals.cpu; payload.memory = vals.memory;
        } else if (instChoice === 'cpuAdv') {
          const vals = await form.validateFields(['cpuSockets','cpuCores','cpuThreads','dedicatedCPUPlacement','cpuRequest','cpuLimit']);
          payload.cpuSockets = vals.cpuSockets; payload.cpuCores = vals.cpuCores; payload.cpuThreads = vals.cpuThreads; payload.dedicatedCPUPlacement = vals.dedicatedCPUPlacement; payload.cpuRequest = vals.cpuRequest; payload.cpuLimit = vals.cpuLimit;
        } else if (instChoice === 'memAdv') {
          const vals = await form.validateFields(['memoryLimit']);
          payload.memoryLimit = vals.memoryLimit;
        } else if (instChoice === 'gpu') {
          const vals = await form.validateFields(['gpuMode','gpuResourceName']);
          const mode = vals.gpuMode; const resName = vals.gpuResourceName;
          if (mode && resName) {
            const list = Array.isArray(gpuResources) ? gpuResources : [];
            if (list.length > 0) {
              const found = list.find((x:any)=> String(x?.type)===String(mode) && String(x?.resourceName)===String(resName));
              if (!found) { message.error(`GPU 资源不可用：${resName}`); return; }
            }
          }
          payload.gpuMode = vals.gpuMode; payload.gpuResourceName = resName; payload.gpuCount = undefined;
        }
        await updateHarvesterVmSpec(cloudId, ns, name, payload);
        message.success('实例配置已更新');
      } else if (tab === 'image') {
        if (imageChoice === 'changeOs') {
          const iid = String(record?.InstanceId || record?.id || '');
          if (!iid || !iid.includes('/')) { message.error('实例ID缺失'); return; }
          const ns = iid.split('/')[0];
          const name = iid.split('/')[1];
          const cpu = Number(record?.Extra?.CPU || 0) || 1;
          const mem = String(record?.Extra?.Memory || '1Gi') || '1Gi';
          const networks: string[] = Array.isArray(record?.Extra?.Networks) ? record.Extra.Networks : [];
          const imageName = values.newOsImage;
          const rootSize = values.newOsRootSize;
          const rootBus = values.newOsBus || 'virtio';
          const scName = values.newOsSc;
          if (!imageName) { message.error('请选择目标操作系统镜像'); return; }
          try {
            await deleteCloudProviderEcs(cloudId, iid);
          } catch (e:any) {
            const msg = String(e?.message||'').toLowerCase();
            if (!msg.includes('not found') && !msg.includes('404')) { throw e; }
          }
          await createHarvesterVm(cloudId, {
            namespace: ns,
            name,
            cpu,
            memory: mem,
            image: imageName,
            networks,
            rootSourceType: 'image',
            rootImage: imageName,
            rootSize: rootSize,
            rootBus,
            storageClassName: scName
          });
          message.success('更换操作系统已提交（重建实例）');
        } else if (imageChoice === 'expandSystemDisk') {
          const claims: string[] = Array.isArray(record?.Extra?.VolumeClaims) ? record?.Extra?.VolumeClaims : [];
          const rootPvc = claims.length ? claims[0] : '';
          const targetNs = ns;
          if (!rootPvc) { message.error('未找到系统盘PVC'); return; }
          const size = values.systemDiskSize;
          if (!size) { message.error('请输入系统盘新容量'); return; }
          await updateHarvesterVolume(cloudId, targetNs, rootPvc, { size });
          message.success('系统盘扩容已提交');
        }
      } else if (tab === 'storage') {
        const action = storageChoice;
        const claims: string[] = Array.isArray(record?.Extra?.VolumeClaims) ? record?.Extra?.VolumeClaims : [];
        if (action === 'add') {
          const pvcName = values.newDiskName;
          const size = values.newDiskSize;
          const sc = values.newDiskSc;
          if (!pvcName || !size) { message.error('请输入新数据盘名称与容量'); return; }
          await createHarvesterVolume(cloudId, { namespace: ns, name: pvcName, size, storageClassName: sc });
          await attachHarvesterVolumeToVmByName(cloudId, ns, name, { diskName: pvcName, bus: values.newDiskBus || 'virtio', pvcNamespace: ns, pvcName });
          message.success('数据盘创建并挂载成功');
        } else if (action === 'expand') {
          const targetPvc = values.expandDiskPvc;
          const size = values.expandDiskSize;
          if (!targetPvc || !size) { message.error('请选择数据盘并输入新容量'); return; }
          await updateHarvesterVolume(cloudId, ns, targetPvc, { size });
          message.success('数据盘扩容已提交');
        } else if (action === 'remove') {
          const diskName = values.removeDiskName;
          if (!diskName) { message.error('请输入要移除的数据盘设备名'); return; }
          await detachHarvesterVolumeFromVm(cloudId, iid, { name: diskName });
          message.success('数据盘移除已提交');
        }
      } else if (tab === 'network') {
        message.info('网络配置变更需要后端支持，当前为占位界面');
      }
      onOk();
      onClose();
    } catch (e: any) {
      message.error(e?.message || '资源变配失败');
    }
  };
  const claims: string[] = Array.isArray(record?.Extra?.VolumeClaims) ? record?.Extra?.VolumeClaims : [];
  const scOptions = (scs || []).map((x:any)=> ({ value: x?.metadata?.name || x?.name, label: x?.metadata?.name || x?.name }));
  return (
    <Modal
      title="资源变配"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="提交"
      destroyOnClose
      width={'60vw'}
      bodyStyle={{ height: '60vh', maxHeight: '60vh', overflowY: 'auto' }}
    >
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key:'inst', label:'实例配置', children:(
          <Row gutter={0} style={{ alignItems: 'stretch' }}>
            <Col span={11} style={{ height: '100%', padding: 0 }}>
              <Radio.Group value={instChoice} onChange={(e)=> setInstChoice(e.target.value)} style={{ width: '100%' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:12, height: '100%', maxHeight: '100%', overflowY: 'auto' }}>
                  <Card hoverable style={{ width: '100%', backgroundColor: instChoice==='spec' ? '#e6f7ff' : undefined }} onClick={()=> setInstChoice('spec')}>
                    <Space align="start">
                      <SlidersOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="spec">更改实例规格（CPU、内存）</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>升级或者降低实例的规格配置</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: instChoice==='cpuAdv' ? '#e6f7ff' : undefined }} onClick={()=> setInstChoice('cpuAdv')}>
                    <Space align="start">
                      <SettingOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="cpuAdv">变更CPU高级配置</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持CPU拓扑、绑定、QoS等高级配置</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: instChoice==='memAdv' ? '#e6f7ff' : undefined }} onClick={()=> setInstChoice('memAdv')}>
                    <Space align="start">
                      <DatabaseOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="memAdv">变更内存高级配置</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持QoS高级配置</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: instChoice==='gpu' ? '#e6f7ff' : undefined }} onClick={()=> setInstChoice('gpu')}>
                    <Space align="start">
                      <RobotOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="gpu">变更GPU</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机变更GPU配置</div>
                  </Card>
                </div>
              </Radio.Group>
            </Col>
            <Col span={1} style={{ height: '100%', padding: 0 }}></Col>
            <Col span={12} style={{ padding: 0 }}>
              <Form
                form={form}
                style={{ width: '100%' }}
                layout="horizontal"
                labelCol={{ span: 8, style: { display: 'flex', justifyContent: 'flex-start' } }}
                wrapperCol={{ span: 16, style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } }}
                labelAlign="left"
              >
                {instChoice === 'spec' && (
                  <>
                    <Form.Item name="cpu" label="CPU(核)" style={{ margin: '12px 0' }} rules={[{ required: true, message: '请输入CPU核数' }]}> 
                      <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="memory" label="内存" style={{ margin: '12px 0' }} rules={[{ required: true, message: '请输入内存' }]}> 
                      <Input placeholder="例如 8Gi" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {instChoice === 'cpuAdv' && (
                  <>
                    <Form.Item name="cpuSockets" label="Sockets" style={{ margin: '12px 0' }}>
                      <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="cpuCores" label="Cores" style={{ margin: '12px 0' }}>
                      <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="cpuThreads" label="Threads" style={{ margin: '12px 0' }}>
                      <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="dedicatedCPUPlacement" label="CPU绑定" style={{ margin: '12px 0' }}>
                      <Switch />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="cpuRequest" label="CPU Request(核)" style={{ margin: '12px 0' }}>
                      <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="cpuLimit" label="CPU Limit(核)" style={{ margin: '12px 0' }}>
                      <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {instChoice === 'memAdv' && (
                  <>
                    <Form.Item name="memoryLimit" label="内存上限" style={{ margin: '12px 0' }} rules={[{ required: true, message: '请输入内存上限' }]}> 
                      <Input placeholder="例如 8Gi" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {instChoice === 'gpu' && (
                  <>
                    <Form.Item name="gpuMode" label="GPU模式" style={{ margin: '12px 0' }} rules={[{ required: true, message: '请选择GPU模式' }]}> 
                      <Select allowClear options={['passthrough','vgpu','sriov'].map(s=>({ value:s, label:s }))} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item label="选择GPU" required>
                      {(function(){
                        const mode = form.getFieldValue('gpuMode')||'passthrough';
                        const list = Array.isArray(gpuResources) ? gpuResources : [];
                        const filtered = list.filter((x:any)=> String(x?.type)===mode);
                        const data = (filtered.length ? filtered : list).map((x:any)=> ({
                          key: `${x?.resourceName}|${x?.node||x?.nodeName}|${x?.pciAddress||x?.address||x?.pci}`,
                          node: x?.node || x?.nodeName || '-',
                          bus: x?.pciAddress || x?.address || x?.pci || '-',
                          name: x?.name || x?.description || x?.desc || x?.resourceName,
                          resourceName: x?.resourceName
                        }));
                        const columns = [
                          { title:'节点', dataIndex:'node', key:'node' },
                          { title:'总线', dataIndex:'bus', key:'bus' },
                          { title:'GPU名称', dataIndex:'resourceName', key:'resourceName' }
                        ];
                        return (
                          <Table
                            size="small"
                            rowKey={(r:any)=> r.key}
                            columns={columns as any}
                            dataSource={data}
                            pagination={false}
                            locale={{ emptyText: (
                              <Space>
                                <span>暂无可用 GPU 资源</span>
                                <Button size="small" onClick={async()=>{ try{ const res=await fetchHarvesterGpuResources(cloudId); const items = Array.isArray(res?.data?.items)?res.data.items:(Array.isArray(res?.items)?res.items:[]); setGpuResources(items);}catch(e:any){ message.error(e?.message||'刷新失败'); } }}>刷新</Button>
                              </Space>
                            ) }}
                            rowSelection={{
                              type:'radio',
                              selectedRowKeys: selectedGpuKey ? [selectedGpuKey] : [],
                              onChange: (keys:any[], rows:any[])=> { const k = keys && keys.length ? String(keys[0]) : null; setSelectedGpuKey(k); const row = rows && rows.length ? rows[0] : null; form.setFieldsValue({ gpuResourceName: row?.resourceName }); }
                            }}
                            onRow={(record:any)=> ({ onClick: ()=> { setSelectedGpuKey(String(record?.key)); form.setFieldsValue({ gpuResourceName: record?.resourceName }); } })}
                          />
                        );
                      })()}
                      <Form.Item name="gpuResourceName" hidden rules={[{ required: true, message: '请选择GPU资源' }]}> 
                        <Input />
                      </Form.Item>
                    </Form.Item>
                    
                  </>
                )}
              </Form>
            </Col>
          </Row>
        ) },
        { key:'image', label:'镜像配置', children:(
          <Row gutter={0} style={{ alignItems: 'stretch' }}>
            <Col span={11} style={{ height: '100%', padding: 0 }}>
              <Radio.Group value={imageChoice} onChange={(e)=> setImageChoice(e.target.value)} style={{ width: '100%' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:12, height: '100%', maxHeight: '100%', overflowY: 'auto' }}>
                  <Card hoverable style={{ width: '100%', backgroundColor: imageChoice==='changeOs' ? '#e6f7ff' : undefined }} onClick={()=> setImageChoice('changeOs')}>
                    <Space align="start">
                      <AppstoreOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="changeOs">更换操作系统</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机更换新的操作系统</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: imageChoice==='expandSystemDisk' ? '#e6f7ff' : undefined }} onClick={()=> setImageChoice('expandSystemDisk')}>
                    <Space align="start">
                      <HddOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="expandSystemDisk">扩容系统盘</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机扩容系统盘</div>
                  </Card>
                </div>
              </Radio.Group>
            </Col>
            <Col span={1} style={{ height: '100%', padding: 0 }}></Col>
            <Col span={12} style={{ padding: 0 }}>
              <Form
                form={form}
                style={{ width: '100%' }}
                layout="horizontal"
                labelCol={{ span: 8, style: { display: 'flex', justifyContent: 'flex-start' } }}
                wrapperCol={{ span: 16, style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } }}
                labelAlign="left"
              >
                {imageChoice === 'changeOs' && (
                  <>
                    <Form.Item name="newOsImage" label="选择镜像" style={{ margin: '12px 0' }} rules={[{ required: true, message: '请选择镜像' }]}> 
                      <Select allowClear options={(images||[]).map((img:any)=> ({ value: img?.name || img?.metadata?.name || img?.displayName, label: img?.displayName || img?.name }))} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="newOsRootSize" label="系统盘大小" style={{ margin: '12px 0' }}> 
                      <Input placeholder="例如 60Gi（可选）" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="newOsSc" label="存储类" style={{ margin: '12px 0' }}> 
                      <Select allowClear options={scOptions} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="newOsBus" label="总线" style={{ margin: '12px 0' }}> 
                      <Select allowClear options={[{value:'virtio',label:'virtio'},{value:'sata',label:'sata'},{value:'scsi',label:'scsi'}]} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {imageChoice === 'expandSystemDisk' && (
                  <>
                    <Form.Item name="systemDiskSize" label="扩容系统盘（PVC）" style={{ margin: '12px 0' }}>
                      <Input placeholder="例如 60Gi" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
              </Form>
            </Col>
          </Row>
        ) },
        { key:'storage', label:'存储配置', children:(
          <Row gutter={0} style={{ alignItems: 'stretch' }}>
            <Col span={11} style={{ height: '100%', padding: 0 }}>
              <Radio.Group value={storageChoice} onChange={(e)=> setStorageChoice(e.target.value)} style={{ width: '100%' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:12, height: '100%', maxHeight: '100%', overflowY: 'auto' }}>
                  <Card hoverable style={{ width: '100%', backgroundColor: storageChoice==='add' ? '#e6f7ff' : undefined }} onClick={()=> setStorageChoice('add')}>
                    <Space align="start">
                      <PlusOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="add">添加数据盘</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机添加新的数据盘</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: storageChoice==='expand' ? '#e6f7ff' : undefined }} onClick={()=> setStorageChoice('expand')}>
                    <Space align="start">
                      <HddOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="expand">扩容数据盘</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机扩容数据盘</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: storageChoice==='remove' ? '#e6f7ff' : undefined }} onClick={()=> setStorageChoice('remove')}>
                    <Space align="start">
                      <DeleteOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="remove">移除数据盘</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机移除数据盘</div>
                  </Card>
                </div>
              </Radio.Group>
            </Col>
            <Col span={1} style={{ height: '100%', padding: 0 }}></Col>
            <Col span={12} style={{ padding: 0 }}>
              <Form
                form={form}
                style={{ width: '100%' }}
                layout="horizontal"
                labelCol={{ span: 8, style: { display: 'flex', justifyContent: 'flex-start' } }}
                wrapperCol={{ span: 16, style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } }}
                labelAlign="left"
              >
                {storageChoice === 'add' && (
                  <>
                    <Form.Item name="newDiskName" label="PVC名称" style={{ margin: '12px 0' }}>
                      <Input style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="newDiskSize" label="容量" style={{ margin: '12px 0' }}>
                      <Input placeholder="例如 100Gi" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="newDiskSc" label="存储类" style={{ margin: '12px 0' }}>
                      <Select allowClear options={scOptions} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    {/* 挂载设备名由系统自动与 PVC 名一致，不再需要用户填写 */}
                    <Form.Item name="newDiskBus" label="总线" style={{ margin: '12px 0' }}>
                      <Select allowClear options={[{value:'virtio',label:'virtio'},{value:'sata',label:'sata'},{value:'scsi',label:'scsi'}]} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {storageChoice === 'expand' && (
                  <>
                    <Form.Item name="expandDiskPvc" label="选择PVC" style={{ margin: '12px 0' }}>
                      <Select allowClear options={(claims||[]).slice(1).map(c=>({ value:c, label:c||'-' }))} style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                    <Form.Item name="expandDiskSize" label="新容量" style={{ margin: '12px 0' }}>
                      <Input placeholder="例如 200Gi" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {storageChoice === 'remove' && (
                  <>
                    <Form.Item name="removeDiskName" label="挂载设备名" style={{ margin: '12px 0' }}>
                      <Input placeholder="例如 disk-2" style={{ width: '100%' }} />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
              </Form>
            </Col>
          </Row>
        ) },
        { key:'network', label:'网络配置', children:(
          <Row gutter={0} style={{ alignItems: 'stretch' }}>
            <Col span={11} style={{ height: '100%', padding: 0 }}>
              <Radio.Group value={networkChoice} onChange={(e)=> setNetworkChoice(e.target.value)} style={{ width: '100%' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:12, height: '100%', maxHeight: '100%', overflowY: 'auto' }}>
                  <Card hoverable style={{ width: '100%', backgroundColor: networkChoice==='mainNic' ? '#e6f7ff' : undefined }} onClick={()=> setNetworkChoice('mainNic')}>
                    <Space align="start">
                      <GlobalOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="mainNic">变更主网卡配置</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机变更主网卡配置</div>
                  </Card>
                  <Card hoverable style={{ width: '100%', backgroundColor: networkChoice==='auxNic' ? '#e6f7ff' : undefined }} onClick={()=> setNetworkChoice('auxNic')}>
                    <Space align="start">
                      <GatewayOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                      <Radio value="auxNic">变更辅助网卡</Radio>
                    </Space>
                    <div style={{ color:'#999', marginTop: 8 }}>支持为云主机变增加或移除辅助网卡，及变更网卡配置</div>
                  </Card>
                </div>
              </Radio.Group>
            </Col>
            <Col span={1} style={{ height: '100%', padding: 0 }}></Col>
            <Col span={12} style={{ padding: 0 }}>
              <Form
                form={form}
                style={{ width: '100%' }}
                layout="horizontal"
                labelCol={{ span: 8, style: { display: 'flex', justifyContent: 'flex-start' } }}
                wrapperCol={{ span: 16, style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } }}
                labelAlign="left"
              >
                {networkChoice === 'mainNic' && (
                  <>
                    <Form.Item label="变更主网卡配置" style={{ margin: '12px 0' }}>
                      <Input disabled placeholder="后端接口准备中（占位）" />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
                {networkChoice === 'auxNic' && (
                  <>
                    <Form.Item label="变更辅助网卡" style={{ margin: '12px 0' }}>
                      <Input disabled placeholder="后端接口准备中（占位）" />
                    </Form.Item>
                    <Divider dashed style={{ margin: '12px 0', width: '100%' }} />
                  </>
                )}
              </Form>
            </Col>
          </Row>
        ) },
      ]} />
    </Modal>
  );
};

export default VmReconfigureModal;
