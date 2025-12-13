import React, { useState } from 'react';
import { Button, Modal, Upload, Input, App } from 'antd';
import { UploadOutlined } from '@ant-design/icons';

interface Props {
  value?: string | string[];
  multiple?: boolean;
  onChange?: (val: string | string[]) => void;
}

const OSSFilePicker: React.FC<Props> = ({ value, multiple, onChange }) => {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [ossPath, setOssPath] = useState<string| string[]>(value || (multiple?[]:''));
  const [uploading, setUploading] = useState(false);

  const handleOk = () => {
    if (multiple ? (Array.isArray(ossPath)?ossPath.length===0:true):!ossPath) {
      message.error('请先选择或上传文件');
      return;
    }
    onChange?.(ossPath);
    setOpen(false);
  };

  const customUpload = async (file: any) => {
    // 这里演示调用后端接口，让后端负责上传到 OSS 并返回 URL
    // 实际生产可改为 STS + OSS SDK 直传
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/model', { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if(multiple){
        setOssPath(prev=>[...(Array.isArray(prev)?prev:[]), data.url]);
      }else{
        setOssPath(data.url);
      }
      message.success('上传成功');
    } catch (e: any) {
      message.error('上传失败: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Input value={Array.isArray(value)?value.join(', '):value} readOnly placeholder="请选择 OSS 文件" addonAfter={<Button onClick={() => setOpen(true)}>选择</Button>} />
      <Modal
        title="选择 OSS 目录或文件"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleOk}
        width={800}
      >
        {/* 简化版：仅提供上传功能，可扩展为浏览 bucket */}
        <Upload.Dragger
          name="file"
          customRequest={({ file }) => customUpload(file as File)}
          showUploadList={false}
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined />
          </p>
          <p className="ant-upload-text">拖拽上传文件或点击选择</p>
          <p className="ant-upload-hint">单文件不超过 1GB，上传后自动保存到对象存储</p>
        </Upload.Dragger>
        {multiple ? Array.isArray(ossPath)&&ossPath.length>0 : ossPath ? true:false? (
          <></>
        ):null}
        {(!multiple && ossPath && typeof ossPath==='string') && (
          <div style={{ marginTop: 16 }}>
            已选择: <span style={{ color: '#1890ff' }}>{ossPath}</span>
          </div>
        )}
        {multiple && Array.isArray(ossPath) && ossPath.length>0 && (
          <div style={{ marginTop:16 }}>
            <div>已选择:</div>
            {ossPath.map(u=>(<div key={u} style={{ color:'#1890ff' }}>{u}</div>))}
          </div>
        )}
      </Modal>
    </>
  );
};

export default OSSFilePicker;