import { DeployDriftCancelledError } from './vrConfigDeployDrift';

describe('vrConfigDeployDrift', () => {
  it('DeployDriftCancelledError has stable name', () => {
    const err = new DeployDriftCancelledError();
    expect(err.name).toBe('DeployDriftCancelledError');
    expect(err.message).toContain('取消');
  });
});
