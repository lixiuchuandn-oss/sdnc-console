import React from 'react';
import { App, Button, Descriptions, Modal, Select, Space } from 'antd';
import { bindHuaweiEip, unbindHuaweiEip, fetchCloudProviderEips, fetchHuaweiPorts } from '../../../../services/api';

type Props = {
  open: boolean;
  cloudId: string;
  eips: any[];
  vmDetail: any;
  portId: string;
  selId: string;
  busy: boolean;
  onClose: () => void;
  onSetSelId: (v: string) => void;
  onSetBusy: (v: boolean) => void;
  onSetEips: (list: any[]) => void;
  onSetVmPorts: (list: any[]) => void;
};

const EipManageModal: React.FC<Props> = ({ open, cloudId, eips, vmDetail, portId, selId, busy, onClose, onSetSelId, onSetBusy, onSetEips, onSetVmPorts }) => {
  const { message } = App.useApp();

  const list: any[] = Array.isArray(eips) ? eips : [];
  const current = list.find((x: any) => String(x?.port_id || '') === String(portId || ''))
    || list.find((x: any) => String(x?.associate_instance?.id || x?.associate_instance?.instance_id || '') === String(portId || ''));
  const available = list.filter((x: any) => !x?.port_id && String(x?.status || '').toUpperCase() !== 'ACTIVE');
  const options = available.map((x: any) => ({ value: String(x?.id || x?.publicip_id || ''), label: `${x?.public_ip_address || x?.publicip_address || x?.ip_address || '-'}（${x?.id || x?.publicip_id || '-'}）` }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={440}
      destroyOnHidden
      footer={null}
      centered
      title={'管理弹性公网IP'}
    >
      <div>
        <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="当前绑定">{current ? `${current?.public_ip_address || current?.publicip_address || current?.ip_address || '-'}` : '未绑定'}</Descriptions.Item>
        </Descriptions>
        {current ? (
          <Space>
            <Button danger disabled={busy} loading={busy} onClick={async () => {
              onSetBusy(true);
              try {
                const eid = String(current?.id || current?.publicip_id || '');
                await unbindHuaweiEip(cloudId, eid);
                const eipJson = await fetchCloudProviderEips(cloudId);
                const eipList: any[] = (eipJson?.data?.publicips) || (eipJson?.publicips) || (eipJson?.data?.publicIps) || (eipJson?.publicIps) || [];
                onSetEips(Array.isArray(eipList) ? eipList : []);
                if (vmDetail?.id || vmDetail?.InstanceId) {
                  const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(vmDetail?.id || vmDetail?.InstanceId || '') });
                  const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || [];
                  onSetVmPorts(Array.isArray(listPorts) ? listPorts : []);
                }
                message.success('解绑成功');
              } catch (e: any) {
                message.error(e?.message || '解绑失败');
              } finally {
                onSetBusy(false);
              }
            }}>解绑</Button>
          </Space>
        ) : (
          <Space>
            <Select
              value={selId || undefined}
              onChange={(v) => onSetSelId(String(v || ''))}
              style={{ width: 280 }}
              placeholder={options.length ? '选择可绑定的EIP' : '暂无可绑定的EIP'}
              options={options}
            />
            <Button type="primary" disabled={!selId || busy} loading={busy} onClick={async () => {
              onSetBusy(true);
              try {
                const eid = String(selId || '');
                if (!eid) { message.warning('请选择EIP'); onSetBusy(false); return; }
                await bindHuaweiEip(cloudId, eid, String(portId || ''));
                const eipJson = await fetchCloudProviderEips(cloudId);
                const eipList: any[] = (eipJson?.data?.publicips) || (eipJson?.publicips) || (eipJson?.data?.publicIps) || (eipJson?.publicIps) || [];
                onSetEips(Array.isArray(eipList) ? eipList : []);
                if (vmDetail?.id || vmDetail?.InstanceId) {
                  const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(vmDetail?.id || vmDetail?.InstanceId || '') });
                  const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || [];
                  onSetVmPorts(Array.isArray(listPorts) ? listPorts : []);
                }
                message.success('绑定成功');
              } catch (e: any) {
                message.error(e?.message || '绑定失败');
              } finally {
                onSetBusy(false);
              }
            }}>绑定</Button>
          </Space>
        )}
      </div>
    </Modal>
  );
};

export default EipManageModal;