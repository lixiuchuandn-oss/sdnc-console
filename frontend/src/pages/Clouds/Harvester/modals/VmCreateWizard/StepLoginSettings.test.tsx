
// Move mock before imports to ensure it is available during module initialization
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: any) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Form } from 'antd';
import StepLoginSettings from './StepLoginSettings';

// Remove beforeAll since we are mocking globally at the top
// beforeAll(() => { ... });

const TestWrapper = ({ onValuesChange }: { onValuesChange?: (changedValues: any, allValues: any) => void }) => {
  const [form] = Form.useForm();
  
  return (
    <Form form={form} onValuesChange={onValuesChange}>
      <StepLoginSettings 
        form={form} 
        sshKeyOptions={[{ label: 'Key1', value: 'key1' }]} 
        reloadSshKeys={jest.fn()} 
      />
      {/* Helper to display hidden field value for testing */}
      <Form.Item shouldUpdate>
        {() => <div data-testid="user-data">{form.getFieldValue('userData')}</div>}
      </Form.Item>
    </Form>
  );
};

describe('StepLoginSettings', () => {
  test('Generate userData correctly when password is set', async () => {
    render(<TestWrapper />);

    // 1. Select password method
    // Antd Radio label click triggers change
    const passwordRadioLabel = screen.getByText('设置账户密码');
    fireEvent.click(passwordRadioLabel);

    // 2. Input password
    // Wait for input to appear
    const passwordInput = await screen.findByPlaceholderText('8-64 位，不含空白或冒号(:)');
    fireEvent.change(passwordInput, { target: { value: 'MySecretPass123' } });

    // 3. Verify user data is generated
    await waitFor(() => {
      const userData = screen.getByTestId('user-data').textContent;
      expect(userData).toContain('ssh_pwauth: true');
      expect(userData).toContain('root:MySecretPass123');
      // Verify standard cloud-config format parts
      expect(userData).toContain('#cloud-config');
      expect(userData).toContain('chpasswd:');
    });
  });

  test('Clear userData when switching away from password', async () => {
    render(<TestWrapper />);

    // 1. Set password first
    const passwordRadioLabel = screen.getByText('设置账户密码');
    fireEvent.click(passwordRadioLabel);
    const passwordInput = await screen.findByPlaceholderText('8-64 位，不含空白或冒号(:)');
    fireEvent.change(passwordInput, { target: { value: 'MySecretPass123' } });

    await waitFor(() => {
        expect(screen.getByTestId('user-data').textContent).toContain('root:MySecretPass123');
    });

    // 2. Switch to 'later'
    const laterRadioLabel = screen.getByText('稍后设置');
    fireEvent.click(laterRadioLabel);

    // 3. Verify userData is cleared
     await waitFor(() => {
        expect(screen.getByTestId('user-data').textContent).toBe('');
    });
  });

  test('Generate cloudmap user data correctly', async () => {
    render(<TestWrapper />);

    // 1. Select password method
    const passwordRadioLabel = screen.getByText('设置账户密码');
    fireEvent.click(passwordRadioLabel);

    // 2. Select cloudmap user
    const cloudmapRadioLabel = screen.getByText('cloudmap');
    fireEvent.click(cloudmapRadioLabel);

    // 3. Input password
    const passwordInput = await screen.findByPlaceholderText('8-64 位，不含空白或冒号(:)');
    fireEvent.change(passwordInput, { target: { value: 'CloudMapPass123' } });

    // 4. Verify user data
    await waitFor(() => {
      const userData = screen.getByTestId('user-data').textContent;
      expect(userData).toContain('name: cloudmap');
      expect(userData).toContain('cloudmap:CloudMapPass123');
      expect(userData).toContain('sudo: [ \'ALL=(ALL) ALL\' ]');
    });
  });
});
