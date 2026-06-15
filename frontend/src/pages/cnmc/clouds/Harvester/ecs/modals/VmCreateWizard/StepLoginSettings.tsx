import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Radio, Input, Select, Row, Col, Typography } from 'antd';

interface StepLoginSettingsProps {
  form: any;
  sshKeyOptions: any[];
  sshKeysLoaded: boolean;
  sshKeysLoading: boolean;
  reloadSshKeys: () => Promise<void> | void;
}

const StepLoginSettings: React.FC<StepLoginSettingsProps> = ({
  form,
  sshKeyOptions,
  sshKeysLoaded,
  sshKeysLoading,
  reloadSshKeys,
}) => {
  const loginMethod = Form.useWatch('loginMethod', form);
  const loginAccount = Form.useWatch('loginAccount', form);
  const loginPassword = Form.useWatch('loginPassword', form);
  const sshNames = Form.useWatch('sshNames', form);

  const lastGeneratedUserDataRef = useRef<string>('');
  const lastGeneratedSshNamesRef = useRef<string>('');
  const [sshQueried, setSshQueried] = useState(false);

  const ensureSshKeysLoaded = useCallback(async () => {
    if (!sshKeysLoaded && !sshKeysLoading) {
      await reloadSshKeys();
    }
  }, [reloadSshKeys, sshKeysLoaded, sshKeysLoading]);

  useEffect(() => {
    if (String(loginMethod || '') !== 'ssh') {
      setSshQueried(false);
    }
  }, [loginMethod]);

  useEffect(() => {
    try {
      const m = String(loginMethod || 'later');

      if (m === 'later') return;

      if (m === 'password') {
        const acct = String(loginAccount || 'root');
        const pwd = String(loginPassword || '').replace(/[\r\n]/g, '').trim();

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

        if (ud === lastGeneratedUserDataRef.current) return;

        if (String(form.getFieldValue('userData') || '') !== ud) {
          form.setFieldsValue({ userData: ud });
          lastGeneratedUserDataRef.current = ud;
        }
      }

      if (m === 'ssh') {
        const selectedKeys = Array.isArray(sshNames) ? sshNames : [];

        if (selectedKeys.length === 0) {
          const currUd = String(form.getFieldValue('userData') || '');
          if (currUd) {
            form.setFieldsValue({ userData: undefined });
          }
          return;
        }

        const selectedKeyObjs = selectedKeys
          .map((name) => sshKeyOptions.find((opt: any) => opt.value === name))
          .filter(Boolean);

        const authorizedKeys = selectedKeyObjs
          .map((keyObj: any) => keyObj?.publicKey || '')
          .filter(Boolean);

        if (authorizedKeys.length === 0) {
          return;
        }

        const acct = String(loginAccount || 'root');
        let ud = '';

        if (acct === 'root') {
          ud = `#cloud-config\nssh_authorized_keys:\n${authorizedKeys.map((k) => `  - ${k}`).join('\n')}\n`;
        } else {
          ud = `#cloud-config\nusers:\n  - name: cloudmap\n    lock_passwd: true\n    sudo: [ 'ALL=(ALL) ALL' ]\n    shell: /bin/bash\n    groups: users\n    ssh_authorized_keys:\n${authorizedKeys.map((k) => `      - ${k}`).join('\n')}\n`;
        }

        const currentUserData = String(form.getFieldValue('userData') || '');

        if (currentUserData !== ud) {
          form.setFieldsValue({ userData: ud });
        }
      }
    } catch {
      /* ignore */
    }
  }, [loginMethod, loginAccount, loginPassword, sshNames, sshKeyOptions, form]);

  const handleLoginMethodChange = (e: any) => {
    const m = e.target.value;

    if (m !== 'password') {
      if (form.getFieldValue('loginPassword')) form.setFieldsValue({ loginPassword: undefined });
    }

    if (m === 'password' || m === 'later') {
      const currUd = String(form.getFieldValue('userData') || '');
      if (currUd) {
        form.setFieldsValue({ userData: undefined });
        lastGeneratedUserDataRef.current = '';
        lastGeneratedSshNamesRef.current = '';
      }
    }

    if (m === 'ssh') {
      const currUd = String(form.getFieldValue('userData') || '');
      if (currUd) {
        form.setFieldsValue({ userData: undefined });
        lastGeneratedUserDataRef.current = '';
      }
      lastGeneratedSshNamesRef.current = '';
    }

    if (m !== 'ssh') {
      const names = form.getFieldValue('sshNames');
      if (Array.isArray(names) && names.length > 0) {
        form.setFieldsValue({ sshNames: undefined });
        lastGeneratedSshNamesRef.current = '';
      }
    }
  };

  const showSshEmptyHint =
    String(loginMethod || '') === 'ssh' &&
    sshQueried &&
    sshKeysLoaded &&
    !sshKeysLoading &&
    (sshKeyOptions || []).length === 0;

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

              if (m === 'password' || m === 'ssh') {
                return (
                  <>
                    <Form.Item
                      label="登录账号"
                      name="loginAccount"
                      rules={[{ required: true, message: '请选择登录账户' }]}
                    >
                      <Radio.Group
                        options={[
                          { label: 'root', value: 'root' },
                          { label: 'cloudmap', value: 'cloudmap' },
                        ]}
                      />
                    </Form.Item>

                    {m === 'password' && (
                      <Form.Item
                        label="登录密码"
                        name="loginPassword"
                        rules={[
                          ({ getFieldValue }) => ({
                            validator: (_: any, val: any) => {
                              if (String(getFieldValue('loginMethod') || 'later') !== 'password') {
                                return Promise.resolve();
                              }
                              const s = String(val || '');
                              if (!s) return Promise.reject(new Error('请输入密码'));
                              if (s.length < 8) return Promise.reject(new Error('密码长度至少 8 位'));
                              if (s.length > 64) return Promise.reject(new Error('密码长度最多 64 位'));
                              if (/[\s:]/.test(s)) {
                                return Promise.reject(new Error('密码不可包含空白字符或冒号(:)'));
                              }
                              return Promise.resolve();
                            },
                          }),
                        ]}
                      >
                        <Input.Password placeholder="8-64 位，不含空白或冒号(:)" autoComplete="new-password" />
                      </Form.Item>
                    )}

                    {m === 'ssh' && (
                      <Form.Item
                        label="选择 SSH 公钥"
                        name="sshNames"
                        extra={
                          showSshEmptyHint
                            ? '未检测到可用的 SSH 密钥，请先在「SSH 密钥」页面创建后重新展开下拉加载'
                            : undefined
                        }
                        rules={[
                          ({ getFieldValue }) => ({
                            validator: (_: any, val: any) => {
                              if (String(getFieldValue('loginMethod') || 'later') !== 'ssh') {
                                return Promise.resolve();
                              }
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
                          loading={sshKeysLoading && !sshKeysLoaded}
                          options={sshKeyOptions || []}
                          notFoundContent={sshKeysLoading ? '加载中…' : '暂无数据'}
                          onOpenChange={(open) => {
                            if (!open) return;
                            setSshQueried(true);
                            void ensureSshKeysLoaded();
                          }}
                          onChange={(vals) => {
                            try {
                              lastGeneratedSshNamesRef.current = JSON.stringify(
                                Array.isArray(vals) ? vals : [],
                              );
                            } catch {
                              /* ignore */
                            }
                          }}
                        />
                      </Form.Item>
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
