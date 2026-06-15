import {
  diskDetachSkipsVmRestartPrompt,
  diskDetachUsesHotplugRemoveVolume,
} from './vmDiskManageDrawerDiskLogic';

describe('diskDetachSkipsVmRestartPrompt', () => {
  it('virtio always requires restart prompt', () => {
    expect(diskDetachSkipsVmRestartPrompt('virtio', 'longhorn')).toBe(false);
    expect(diskDetachSkipsVmRestartPrompt('virtio', 'ceph-rbd')).toBe(false);
  });

  it('Longhorn SCSI skips restart prompt', () => {
    expect(diskDetachSkipsVmRestartPrompt('scsi', 'longhorn')).toBe(true);
    expect(diskDetachSkipsVmRestartPrompt('SCSI', 'longhorn-static')).toBe(true);
  });

  it('Ceph SCSI requires restart prompt', () => {
    expect(diskDetachSkipsVmRestartPrompt('scsi', 'ceph-rbd')).toBe(false);
    expect(diskDetachSkipsVmRestartPrompt('scsi', 'rook-ceph-block')).toBe(
      false,
    );
  });

  it('unknown storage class on SCSI keeps Longhorn-like skip', () => {
    expect(diskDetachSkipsVmRestartPrompt('scsi', '')).toBe(true);
    expect(diskDetachSkipsVmRestartPrompt('scsi', 'custom-sc')).toBe(true);
  });
});

describe('diskDetachUsesHotplugRemoveVolume', () => {
  it('aligns with restart skip policy', () => {
    expect(diskDetachUsesHotplugRemoveVolume('scsi', 'longhorn')).toBe(true);
    expect(diskDetachUsesHotplugRemoveVolume('scsi', 'ceph-rbd')).toBe(false);
  });
});
