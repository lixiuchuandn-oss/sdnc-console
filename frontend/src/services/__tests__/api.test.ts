import { bindTenantVR } from '../api';

// Mock the global fetch
global.fetch = jest.fn();

describe('api service', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => 'mock-token'),
      },
      writable: true
    });
  });

  it('bindTenantVR should call the correct endpoint with payload', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'bound successfully' }),
    });

    const payload = {
      vr_uuid: 'vr-123',
      vm_id: 'vm-123',
      tenant_id: 'tenant-1',
      org_id: 'org-1',CSMCTL 扩展信息 (VR3)
      display_name: 'My VR',
      vr_type: 'SASE'
    };

    const result = await bindTenantVR(payload);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];

    expect(url).toContain('/api/vr-config/bind');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Authorization']).toBe('Bearer mock-token');
    expect(JSON.parse(options.body)).toEqual(payload);
    expect(result).toEqual({ success: true, message: 'bound successfully' });
  });

  it('bindTenantVR should support optional vr_type', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'bound successfully' }),
    });

    const payload = {
      vr_uuid: 'vr-456',
      tenant_id: 'tenant-2',
      vr_type: 'PE'
    };

    await bindTenantVR(payload);

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('bindTenantVR should throw error on failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ message: 'Bind failed' }),
    });

    const payload = {
      vr_uuid: 'vr-123',
      tenant_id: 'tenant-1'
    };

    await expect(bindTenantVR(payload)).rejects.toThrow('Bind failed');
  });
});
