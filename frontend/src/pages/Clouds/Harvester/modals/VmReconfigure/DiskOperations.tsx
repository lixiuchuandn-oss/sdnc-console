import React, { useEffect, useState } from 'react';
import { Form, Input, Select, InputNumber, Alert, Descriptions, Collapse, Typography, Space, Tabs, Steps, Divider } from 'antd';
import { WindowsOutlined, CodeOutlined } from '@ant-design/icons';

const { Text, Paragraph, Title } = Typography;

type Props = {
  form: any;
  scOptions: any[];
  reloadScs: () => void;
  selectedKey: string;
  systemDisk?: string;
  systemDiskSize?: number | null;
  loading?: boolean;
};

const DiskOperations: React.FC<Props> = ({
  form,
  scOptions,
  reloadScs,
  selectedKey,
  systemDisk,
  systemDiskSize,
  loading
}) => {
  // Parse current system disk size from record if available
  // Assuming claims[0] is the system disk name, but we need its size.
  // For now, we'll let the user input the new size, but we can improve this by passing more data.
  
  switch (selectedKey) {
    case 'expand_system_disk':
      return (
        <>      
          <Alert
            description={
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                <li>扩容操作仅支持增加容量，不可减少。</li>
                <li>平台层扩容完成后，<strong>必须</strong>进入操作系统内部扩展文件系统才能生效。</li>
                <li>部分操作系统可能需要重启才能识别新的磁盘大小。</li>
              </ul>
            }
            type="info"
            style={{padding: 12, marginBottom: 16 }}
          />   
          <Form.Item 
            label="当前系统盘"
            tooltip="对应底层存储的 PVC 名称，通常格式为 {实例ID}-{磁盘名}-{随机后缀}"
          >
             <Input 
                value={systemDisk ? `${systemDisk} ${systemDiskSize ? `(${systemDiskSize} GiB)` : ''}` : '未找到系统盘'} 
                readOnly 
                style={{ color: '#00000040' }} 
                suffix={loading ? <span style={{ fontSize: 12, color: '#999' }}>加载中...</span> : null}
             />
          </Form.Item>
          
          <Form.Item 
            name="systemDiskSize" 
            label="新容量 (GiB)" 
            rules={[
              { required: true, message: '请输入新容量' },
              {
                 validator: async (_, value) => {
                    if (!value) return;
                    if (value <= 0) throw new Error('容量必须大于 0');
                    if (systemDiskSize && value < systemDiskSize) {
                       throw new Error(`新容量必须大于等于当前容量 (${systemDiskSize} GiB)`);
                    }
                 }
              }
            ]}
          >
            <InputNumber 
              addonAfter="GiB" 
              style={{ width: '100%' }} 
              placeholder="请输入扩容后的总容量" 
              min={systemDiskSize || 1}
            />
          </Form.Item>
                    <Collapse 
            ghost 
            items={[{
              key: '1',
              label: <span>操作指南：如何在操作系统内部完成扩容？</span>,
              children: (
                <div style={{ padding: '0 12px' }}>
                  <Tabs
                    defaultActiveKey="linux"
                    size="small"
                    type="card"
                    items={[
                      {
                        key: 'linux',
                        label: <span><CodeOutlined /> Linux 系统</span>,
                        children: (
                          <div style={{ marginTop: 12 }}>
                             <Steps
                               direction="vertical"
                               size="small"
                               items={[
                                 {
                                   title: '第一步：安装扩容工具',
                                   status: 'process',
                                   description: (
                                     <div style={{ marginTop: 12, marginBottom: 24 }}>
                                       <div style={{ marginBottom: 8 }}>根据您的发行版选择命令：</div>
                                       <div style={{ background: '#1e1e1e', padding: '12px 16px', borderRadius: 6, fontFamily: 'monospace', border: '1px solid #333' }}>
                                         <div style={{ color: '#6a9955' }}># CentOS / RHEL</div>
                                         <div style={{ color: '#d4d4d4' }}>yum install -y cloud-utils-growpart</div>
                                         <div style={{ color: '#6a9955', marginTop: 8 }}># Ubuntu / Debian</div>
                                         <div style={{ color: '#d4d4d4' }}>apt install -y cloud-guest-utils</div>
                                       </div>
                                     </div>
                                   )
                                 },
                                 {
                                   title: '第二步：扩展分区表',
                                   status: 'process',
                                   description: (
                                     <div style={{ marginTop: 12, marginBottom: 24 }}>
                                       <div style={{ marginBottom: 8 }}>将物理磁盘的剩余空间分配给分区（以系统盘 <Text code>/dev/vda</Text> 的第1个分区为例）：</div>
                                       <div style={{ background: '#1e1e1e', padding: '12px 16px', borderRadius: 6, fontFamily: 'monospace', border: '1px solid #333' }}>
                                         <div style={{ color: '#d4d4d4' }}>growpart /dev/vda 1</div>
                                       </div>
                                       <div style={{ fontSize: 12, color: '#faad14', marginTop: 8 }}>注意：如果是其他盘符（如 vdb），请相应修改命令。</div>
                                     </div>
                                   )
                                 },
                                 {
                                   title: '第三步：扩展文件系统',
                                   status: 'process',
                                   description: (
                                     <div style={{ marginTop: 12 }}>
                                       <div style={{ marginBottom: 8 }}>根据文件系统类型执行不同命令：</div>
                                       <div style={{ background: '#1e1e1e', padding: '12px 16px', borderRadius: 6, fontFamily: 'monospace', border: '1px solid #333' }}>
                                          <div style={{ color: '#6a9955' }}># 情况 A：ext4 文件系统</div>
                                          <div style={{ color: '#d4d4d4' }}>resize2fs /dev/vda1</div>
                                          <Divider style={{ margin: '12px 0', borderColor: '#444' }} dashed />
                                          <div style={{ color: '#6a9955' }}># 情况 B：xfs 文件系统</div>
                                          <div style={{ color: '#d4d4d4' }}>xfs_growfs /</div>
                                       </div>
                                       <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>提示：使用 <Text code>df -Th</Text> 命令可查看文件系统类型。</div>
                                     </div>
                                   )
                                 }
                               ]}
                             />
                          </div>
                        )
                      },
                      {
                        key: 'windows',
                        label: <span><WindowsOutlined /> Windows 系统</span>,
                        children: (
                          <div style={{ marginTop: 12 }}>
                             <Steps
                                direction="vertical"
                                size="small"
                                items={[
                                  {
                                    title: '进入系统',
                                    status: 'process',
                                    description: (
                                      <div style={{ marginTop: 12, marginBottom: 24 }}>
                                        通过远程桌面 (RDP) 或 Web 控制台登录 Windows 实例。
                                      </div>
                                    )
                                  },
                                  {
                                    title: '打开磁盘管理',
                                    status: 'process',
                                    description: (
                                       <div style={{ marginTop: 12, marginBottom: 24 }}>
                                         右键点击左下角 <Text strong>开始菜单</Text>，选择 <Text strong>磁盘管理 (Disk Management)</Text>。
                                       </div>
                                    )
                                  },
                                  {
                                    title: '扩展卷',
                                    status: 'process',
                                    description: (
                                      <div style={{ marginTop: 12 }}>
                                        <ol style={{ paddingLeft: 20, margin: '0' }}>
                                          <li>找到磁盘 0 (通常是 C 盘所在磁盘)。</li>
                                          <li>您会看到 C 盘右侧出现了一块 <Text strong>未分配 (Unallocated)</Text> 的黑色区域。</li>
                                          <li>右键点击 C 盘分区，选择 <Text strong>扩展卷 (Extend Volume)...</Text>。</li>
                                          <li>在弹出的向导中直接点击 <Text strong>下一步</Text> 直至完成。</li>
                                        </ol>
                                      </div>
                                    )
                                  }
                                ]}
                             />
                          </div>
                        )
                      }
                    ]}
                  />
                </div>
              )
            }]}
            style={{ marginBottom: 24, background: '#ffffff', borderRadius: 8, border: '1px solid #e8e8e8' }}
          />
        </>
      );
    case 'add_disk':
      return (
        <>
          <Form.Item name="newDiskName" label="磁盘名称" rules={[{ required: true }]}>
            <Input placeholder="disk-name" />
          </Form.Item>
          <Form.Item name="newDiskSize" label="容量" rules={[{ required: true }]}>
            <Input placeholder="10Gi" />
          </Form.Item>
          <Form.Item name="newDiskSc" label="存储池" rules={[{ required: true }]}>
            <Select 
              placeholder="请选择存储类"
              onDropdownVisibleChange={(open) => { if (open) reloadScs(); }}
              options={scOptions} 
            />
          </Form.Item>
          <Form.Item name="newDiskBus" label="总线类型" initialValue="virtio">
            <Select options={['virtio', 'scsi', 'sata'].map(v => ({ label: v, value: v }))} />
          </Form.Item>
        </>
      );
    default:
      return null;
  }
};

export default DiskOperations;
