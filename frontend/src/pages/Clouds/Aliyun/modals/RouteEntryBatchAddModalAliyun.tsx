import React, { useState } from 'react';
import { App, Modal, Input, Form, Alert, Select, Radio, Space } from 'antd';
import { addCloudProviderRouteEntry } from '../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  routeTableId: string;
  onClose: () => void;
  onSuccess: () => void;
};

const RouteEntryBatchAddModalAliyun: React.FC<Props> = ({ open, cloudId, routeTableId, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple'); // simple: text area, advanced: TODO

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const content = values.content;
      if (!content || !content.trim()) return;

      setLoading(true);
      const lines = content.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
      
      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];

      // Process in chunks to avoid browser freeze if too many, though usually it's < 100
      // For now, simple Promise.all is fine for typical usage (< 50 items)
      // Format: CIDR, NextHopId, [Type]
      // Example: 192.168.0.0/24, i-bp1xxxxx
      // Example: 10.0.0.0/8, eni-bp1xxxxx, NetworkInterface
      
      const tasks = lines.map(async (line: string) => {
        try {
          const parts = line.split(/[,\s]+/).map((p: string) => p.trim());
          if (parts.length < 2) throw new Error('格式错误');
          
          const destination = parts[0];
          const nexthop = parts[1];
          let type = 'Ecs'; // default
          
          // Auto-detect type based on prefix if not provided
          if (parts.length >= 3) {
            type = parts[2];
          } else {
            if (nexthop.startsWith('i-')) type = 'Instance';
            else if (nexthop.startsWith('eni-')) type = 'NetworkInterface';
            else if (nexthop.startsWith('ngw-')) type = 'NatGateway';
            else if (nexthop.startsWith('vpn-')) type = 'VpnGateway';
            else if (nexthop.startsWith('havip-')) type = 'HaVip';
            else if (nexthop.startsWith('ri-')) type = 'RouterInterface';
            else if (nexthop.startsWith('ipv6gw-')) type = 'Ipv6Gateway';
          }

          // Normalize type for API
          const typeLower = type.toLowerCase();
          let apiType = typeLower;
          if (typeLower === 'ecs' || typeLower === 'instance') apiType = 'ecs'; // or 'instance' depending on API? API usually expects 'ecs' or 'Instance'. Let's check aliyunApi.ts usage. 
          // addCloudProviderRouteEntry logic: type is passed directly. 
          // RouteEntryCreateDrawerAliyun.tsx uses: 'ecs' mapped to 'instance' or kept as 'ecs'?
          // Wait, RouteEntryCreateDrawerAliyun.tsx sends { type: 'ecs', ... }. 
          // Let's stick to what API expects. Aliyun API usually expects 'Instance', 'NetworkInterface'.
          // But our backend might map it.
          // In RouteEntryCreateDrawerAliyun.tsx: 
          // const t = String(values?.type || 'ecs').toLowerCase(); 
          // It sends 'ecs', 'eni', 'nat', 'vpn' etc. based on its internal logic?
          // No, RouteEntryCreateDrawerAliyun.tsx sends `type: t` where t is from Select options values: 'instance', 'networkinterface', 'natgateway', etc.
          // Wait, the drawer has `initialValue="instance"`. 
          // So we should send 'instance', 'networkinterface' etc.
          
          if (apiType === 'ecs') apiType = 'instance';
          if (apiType === 'eni') apiType = 'networkinterface';
          if (apiType === 'nat') apiType = 'natgateway';
          if (apiType === 'vpn') apiType = 'vpngateway';

          await addCloudProviderRouteEntry(cloudId, routeTableId, { 
            destination, 
            nexthop, 
            type: apiType 
          });
          successCount++;
        } catch (e: any) {
          failCount++;
          errors.push(`${line}: ${e.message}`);
        }
      });

      await Promise.all(tasks);

      setLoading(false);
      
      if (failCount === 0) {
        message.success(`成功添加 ${successCount} 条路由`);
        onSuccess();
        onClose();
      } else {
        message.warning(`完成：成功 ${successCount}，失败 ${failCount}`);
        console.error('Batch add errors:', errors);
        if (successCount > 0) onSuccess();
        // Keep modal open if failures? Maybe close and show error log.
        // For simplicity, close and show warning.
        onClose(); 
      }

    } catch (e) {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="批量添加路由条目"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      width={600}
    >
      <Alert message="格式说明：目的网段, 下一跳ID, [类型]" description="每行一条。类型可选，若不填则尝试根据ID前缀自动识别（i-对应ECS，eni-对应弹性网卡等）。" type="info" showIcon style={{ marginBottom: 16 }} />
      <Form form={form} layout="vertical">
        <Form.Item name="content" label="路由列表" rules={[{ required: true, message: '请输入内容' }]}>
          <Input.TextArea rows={10} placeholder={'192.168.1.0/24, i-bp1xxxxx\n10.0.0.0/8, eni-bp1yyyyy, NetworkInterface'} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RouteEntryBatchAddModalAliyun;
