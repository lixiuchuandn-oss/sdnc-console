import React, { useEffect, useRef } from 'react';
import { Form, Radio, Input, Select, Row, Col, Typography } from 'antd';

interface StepLoginSettingsProps {
  form: any;
  sshKeyOptions: any[];
  reloadSshKeys: () => void;
}

const StepLoginSettings: React.FC<StepLoginSettingsProps> = ({ form, sshKeyOptions, reloadSshKeys }) => {
  const loginMethod = Form.useWatch('loginMethod', form);
  const loginAccount = Form.useWatch('loginAccount', form);
  const loginPassword = Form.useWatch('loginPassword', form);
  const sshNames = Form.useWatch('sshNames', form);

  const lastGeneratedUserDataRef = useRef<string>('');
  const lastGeneratedSshNamesRef = useRef<string>('');

  useEffect(() => {
    try {
      const m = String(loginMethod || 'later');

      if (m === 'later') return;

      if (m === 'password') {
        const acct = String(loginAccount || 'root');
        const pwd = String(loginPassword || '').replace(/[\r\n]/g, '').trim();
        
        // 如果密码为空，清空 Cloud-Config
        if (!pwd) {
          const currUd = String(form.getFieldValue('userData') || '');
          if (currUd) {
            form.setFieldsValue({ userData: undefined });
            lastGeneratedUserDataRef.current = '';
          }
          return;
        }
        
        const ud =
          acct === 'root'
            ? `#cloud-config\nssh_pwauth: true\ndisable_root: false\nchpasswd:\n  expire: false\n  list: |\n    root:${pwd}\n`
            : `#cloud-config\nusers:\n  - name: cloudmap\n    lock_passwd: false\n    sudo: [ 'ALL=(ALL) ALL' ]\n    shell: /bin/bash\n    groups: users\n    ssh_pwauth: true\nssh_pwauth: true\nchpasswd:\n  expire: false\n  list: |\n    cloudmap:${pwd}\n`;

        // 如果生成的内容与上次一致（即输入未变），则不覆盖表单值，以保留用户在高级设置中的手动修改
        if (ud === lastGeneratedUserDataRef.current) return;

        if (String(form.getFieldValue('userData') || '') !== ud) {
          form.setFieldsValue({ userData: ud });
          lastGeneratedUserDataRef.current = ud;
        }
      }

      if (m === 'ssh') {
        const selectedKeys = Array.isArray(sshNames) ? sshNames : [];
        console.log('SSH mode - selectedKeys:', selectedKeys);
        
        // 如果没有选择密钥，清空 Cloud-Config
        if (selectedKeys.length === 0) {
          const currUd = String(form.getFieldValue('userData') || '');
          if (currUd) {
            form.setFieldsValue({ userData: undefined });
          }
          console.log('SSH mode - no keys selected, returning');
          return;
        }
        
        // 获取选中的 SSH 公钥内容
        const selectedKeyObjs = selectedKeys
          .map(name => sshKeyOptions.find((opt: any) => opt.value === name))
          .filter(Boolean);
        console.log('SSH mode - selectedKeyObjs:', selectedKeyObjs);
        
        const authorizedKeys = selectedKeyObjs
          .map((keyObj: any) => keyObj?.publicKey || '')
          .filter(Boolean);
        console.log('SSH mode - authorizedKeys:', authorizedKeys);
        
        if (authorizedKeys.length === 0) {
          console.log('SSH mode - no public keys found, returning');
          return;
        }

        const acct = String(loginAccount || 'root');
        let ud = '';
        
        if (acct === 'root') {
          ud = `#cloud-config\nssh_authorized_keys:\n${authorizedKeys.map(k => `  - ${k}`).join('\n')}\n`;
        } else {
          ud = `#cloud-config\nusers:\n  - name: cloudmap\n    lock_passwd: true\n    sudo: [ 'ALL=(ALL) ALL' ]\n    shell: /bin/bash\n    groups: users\n    ssh_authorized_keys:\n${authorizedKeys.map(k => `      - ${k}`).join('\n')}\n`;
        }

        console.log('SSH mode - generated userData:', ud);

        const currentUserData = String(form.getFieldValue('userData') || '');
        console.log('SSH mode - currentUserData:', currentUserData);
        console.log('SSH mode - ud:', ud);
        
        if (currentUserData !== ud) {
          console.log('SSH mode - setting userData');
          form.setFieldsValue({ userData: ud });
        } else {
          console.log('SSH mode - userData already set');
        }
      }
    } catch {}
  }, [loginMethod, loginAccount, loginPassword, sshNames, sshKeyOptions, form]);

  const handleLoginMethodChange = (e: any) => {
    const m = e.target.value;
    
    // 切换到非密码模式时，清空密码
    if (m !== 'password') {
      if (form.getFieldValue('loginPassword')) form.setFieldsValue({ loginPassword: undefined });
    }

    // 切换到密码模式或稍后设置时，清空之前的 Cloud-Config
    if (m === 'password' || m === 'later') {
      const currUd = String(form.getFieldValue('userData') || '');
      if (currUd) {
        form.setFieldsValue({ userData: undefined });
        lastGeneratedUserDataRef.current = '';
        lastGeneratedSshNamesRef.current = '';
      }
    }

    // 切换到 SSH 模式时，清空之前的 Cloud-Config 并重置引用
    if (m === 'ssh') {
      const currUd = String(form.getFieldValue('userData') || '');
      if (currUd) {
        form.setFieldsValue({ userData: undefined });
        lastGeneratedUserDataRef.current = '';
      }
      lastGeneratedSshNamesRef.current = '';
    }

    // 切换到非 SSH 模式时，清空 SSH 密钥选择
    if (m !== 'ssh') {
      const names = form.getFieldValue('sshNames');
      if (Array.isArray(names) && names.length > 0) {
        form.setFieldsValue({ sshNames: undefined });
        lastGeneratedSshNamesRef.current = '';
      }
    }
  };

  return (
    <>
      <Typography.Paragraph type="secondary">设置系统登录方式</Typography.Paragraph>
      <div className="wizard-group-title">登录与凭据</div>
      <Row gutter={16}>
        <Col span={24}>
          <Form.Item
            label="登录方式"
            name="loginMethod"
            rules={[{ required: true, message: '请选择登录设置方式' }]}
          >
            <Radio.Group
              onChange={handleLoginMethodChange}
              options={[
                { label: '设置账户密码', value: 'password' },
                { label: '设置 SSH 公钥', value: 'ssh' },
                { label: '稍后设置', value: 'later' },
              ]}
            />
          </Form.Item>
        </Col>

        <Col span={24}>
          <Form.Item shouldUpdate={(p, c) => p.loginMethod !== c.loginMethod} noStyle>
            {() => {
              const m = String(form.getFieldValue('loginMethod') || 'later');
              
              // 只有选择"设置账户密码"或"设置 SSH 公钥"时才显示登录账号
              if (m === 'password' || m === 'ssh') {
                return (
                  <>
                    <Form.Item
                      label="登录账号"
                      name="loginAccount"
                      rules={[{ required: true, message: '请选择登录账户' }]}
                    >
                      <Radio.Group options={[{ label: 'root', value: 'root' }, { label: 'cloudmap', value: 'cloudmap' }]} />
                    </Form.Item>
                    
                    {m === 'password' && (
                      <>
                        <Form.Item
                          label="登录密码"
                          name="loginPassword"
                          rules={[
                            ({ getFieldValue }) => ({
                              validator: (_: any, val: any) => {
                                if (String(getFieldValue('loginMethod') || 'later') !== 'password') return Promise.resolve();
                                const s = String(val || '');
                                if (!s) return Promise.reject(new Error('请输入密码'));
                                if (s.length < 8) return Promise.reject(new Error('密码长度至少 8 位'));
                                if (s.length > 64) return Promise.reject(new Error('密码长度最多 64 位'));
                                if (/[\s:]/.test(s)) return Promise.reject(new Error('密码不可包含空白字符或冒号(:)'));
                                return Promise.resolve();
                              },
                            }),
                          ]}
                        >
                          <Input.Password placeholder="8-64 位，不含空白或冒号(:)" autoComplete="new-password" />
                        </Form.Item>
                      </>
                    )}
                    
                    {m === 'ssh' && (
                      <>
                        <Form.Item
                          label="选择 SSH 公钥"
                          name="sshNames"
                          rules={[
                            ({ getFieldValue }) => ({
                              validator: (_: any, val: any) => {
                                if (String(getFieldValue('loginMethod') || 'later') !== 'ssh') return Promise.resolve();
                                const arr = Array.isArray(val) ? val : [];
                                if (arr.length === 0) return Promise.reject(new Error('请选择 SSH 密钥'));
                                return Promise.resolve();
                              },
                            }),
                          ]}
                        >
                          <Select
                            mode="multiple"
                            placeholder="选择 SSH 公钥"
                            options={sshKeyOptions || []}
                            onOpenChange={(open) => {
                              if (open) reloadSshKeys();
                            }}
                            onChange={(vals) => {
                              try {
                                lastGeneratedSshNamesRef.current = JSON.stringify(Array.isArray(vals) ? vals : []);
                              } catch {}
                            }}
                          />
                        </Form.Item>
                      </>
                    )}
                  </>
                );
              }
              
              return null;
            }}
          </Form.Item>
        </Col>
      </Row>
    </>
  );
};

export default StepLoginSettings;

