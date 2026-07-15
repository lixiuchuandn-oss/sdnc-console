import React from 'react';
import { Col, Row } from 'antd';
import IbrWizardCard from './IbrWizardCard';
import {
  IBR_WIZARD_GUTTER,
  IBR_WIZARD_SPANS,
  type IbrWizardLayoutMode,
} from './ibrWizardLayout';

export type IbrWizardShellProps = {
  /** 线性创建（步骤+主表单+预览）或双列对比（步骤+回读+编辑+预览）；同一向导可按步骤切换 */
  layout: IbrWizardLayoutMode;
  /** 放入左侧「步骤」Card 内，通常为 vertical Steps */
  steps: React.ReactNode;
  /** 仅 compare：设备回读等左栏（通常已包 IbrWizardCard） */
  mirror?: React.ReactNode;
  /** 主内容（linear）或配置编辑（compare），通常已包 IbrWizardCard */
  main: React.ReactNode;
  /** 右侧预览（通常已包 sticky IbrWizardCard） */
  preview: React.ReactNode;
};

/**
 * IBR 向导外层栅格壳。业务 Card / Footer 由调用方组装；本组件只统一列宽与步骤侧栏。
 */
const IbrWizardShell: React.FC<IbrWizardShellProps> = ({ layout, steps, mirror, main, preview }) => {
  const spans = layout === 'compare' ? IBR_WIZARD_SPANS.compare : IBR_WIZARD_SPANS.linear;

  return (
    <Row gutter={IBR_WIZARD_GUTTER}>
      <Col span={spans.steps}>
        <IbrWizardCard sticky title="步骤">
          {steps}
        </IbrWizardCard>
      </Col>
      {layout === 'compare' ? <Col span={IBR_WIZARD_SPANS.compare.mirror}>{mirror}</Col> : null}
      <Col span={spans.main}>{main}</Col>
      <Col span={spans.preview}>{preview}</Col>
    </Row>
  );
};

export default IbrWizardShell;
