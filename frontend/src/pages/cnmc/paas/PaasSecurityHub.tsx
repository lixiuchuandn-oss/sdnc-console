import React from 'react';
import { Result } from 'antd';
import PageContainer from '../../../components/PageContainer';

/**
 * 云安全类 PaaS 占位：后续可接入 WAF、主机安全等订购型能力。
 */
const PaasSecurityHub: React.FC = () => {
  return (
    <PageContainer bordered={false} asCard={false}>
      <Result
        status="info"
        title="能力建设中"
        subTitle="云安全托管服务正在规划与接入，敬请期待。"
      />
    </PageContainer>
  );
};

export default PaasSecurityHub;
