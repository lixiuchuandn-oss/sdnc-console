import React from 'react';
import { Drawer, Spin } from 'antd';
import CodeEditor from '../../../../../../../components/CodeEditor';

export type CephBlockCrYamlDrawerProps = {
  open: boolean;
  title: string;
  yamlText: string;
  loading: boolean;
  onClose: () => void;
};

const CephBlockCrYamlDrawer: React.FC<CephBlockCrYamlDrawerProps> = ({
  open,
  title,
  yamlText,
  loading,
  onClose,
}) => (
  <Drawer title={title} width={640} open={open} onClose={onClose} destroyOnClose>
    <Spin spinning={loading}>
      <CodeEditor language="yaml" value={yamlText} readOnly height={480} />
    </Spin>
  </Drawer>
);

export default CephBlockCrYamlDrawer;
