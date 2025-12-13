import React from 'react';
import { Result, Button } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

const ComingSoon: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const feature = params.get('feature');

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Result
        status="info"
        title={feature ? `${feature} 功能正在建设中` : '该功能正在建设中'}
        subTitle="我们正在加紧开发，敬请期待。您可以先浏览其它功能。"
        extra={<Button type="primary" onClick={() => navigate(-1)}>返回上一页</Button>}
      />
    </div>
  );
};

export default ComingSoon;