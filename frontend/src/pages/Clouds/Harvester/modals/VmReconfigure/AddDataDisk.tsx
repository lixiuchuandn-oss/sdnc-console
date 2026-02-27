import React from 'react';
import { Form, Input, InputNumber, Select, Alert } from 'antd';
import { FormInstance } from 'antd/es/form';

type Props = {
  form: FormInstance;
  scOptions: any[];
  reloadScs: () => void;
};

const AddDataDisk: React.FC<Props> = ({ form, scOptions, reloadScs }) => {
  return (
    <>
      <Alert
        message="操作提示"
        description="新添加的磁盘将作为空白数据盘挂载到虚拟机。添加完成后，您可能需要登录系统进行分区和格式化操作才能使用。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Form.Item
        name="newDiskName"
        label="磁盘名称"
        rules={[
          { required: true, message: '请输入磁盘名称' },
          { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '名称必须由小写字母、数字或连字符组成，且开头结尾必须是字母或数字' }
        ]}
        help="建议使用有意义的名称，例如: data-disk-01"
      >
        <Input placeholder="请输入磁盘名称" />
      </Form.Item>

      <Form.Item
        name="newDiskSize"
        label="容量 (GiB)"
        initialValue={10}
        rules={[{ required: true, message: '请输入容量' }]}
      >
        <InputNumber min={1} suffix="GiB" style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        name="newDiskSc"
        label="存储类 (StorageClass)"
        rules={[{ required: true, message: '请选择存储类' }]}
      >
        <Select 
          options={scOptions} 
          placeholder="请选择存储类" 
          onDropdownVisibleChange={(open) => open && reloadScs()}
        />
      </Form.Item>

      <Form.Item
        name="newDiskBus"
        label="总线类型 (Bus)"
        initialValue="virtio"
        tooltip="通常建议使用 VirtIO 以获得最佳性能。如果操作系统不支持 VirtIO 驱动，可尝试 SCSI 或 SATA。"
      >
        <Select>
          <Select.Option value="virtio">VirtIO</Select.Option>
          <Select.Option value="scsi">SCSI</Select.Option>
          <Select.Option value="sata">SATA</Select.Option>
        </Select>
      </Form.Item>
    </>
  );
};

export default AddDataDisk;
