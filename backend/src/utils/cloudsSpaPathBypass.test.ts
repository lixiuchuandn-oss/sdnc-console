import type { Request } from 'express';
import { isCloudsSpaDocumentRequest } from './cloudsSpaPathBypass';

function mockReq(method: string, path: string): Request {
  return { method, path, url: path } as Request;
}

describe('isCloudsSpaDocumentRequest', () => {
  it('bypasses Harvester VNC SPA path', () => {
    expect(
      isCloudsSpaDocumentRequest(
        mockReq('GET', '/4cb21a47-0c8d-4b01-9f1e-994690bb29cb/harvester/vnc'),
      ),
    ).toBe(true);
  });

  it('bypasses instance create SPA path', () => {
    expect(
      isCloudsSpaDocumentRequest(mockReq('GET', '/pool-1/instances/create')),
    ).toBe(true);
  });

  it('does not bypass clouds API paths', () => {
    expect(isCloudsSpaDocumentRequest(mockReq('GET', '/pool-1'))).toBe(false);
    expect(
      isCloudsSpaDocumentRequest(mockReq('GET', '/pool-1/resources/harvester/vms')),
    ).toBe(false);
    expect(isCloudsSpaDocumentRequest(mockReq('POST', '/pool-1/harvester/vnc'))).toBe(false);
  });
});
