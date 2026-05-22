import {
  classifyPortStatus,
  isHuaweiStyleLogicalInterfaceName,
} from './parseAswCtlInterfaceStdout';

describe('parseAswCtlInterfaceStdout helpers', () => {
  describe('classifyPortStatus', () => {
    it('classifies link up/down and admin down', () => {
      expect(classifyPortStatus('up')).toBe('up');
      expect(classifyPortStatus('down')).toBe('down');
      expect(classifyPortStatus('admin down')).toBe('admin');
      expect(classifyPortStatus('')).toBe('unknown');
    });
  });

  describe('isHuaweiStyleLogicalInterfaceName', () => {
    it('treats Vlanif and NULL as logical', () => {
      expect(isHuaweiStyleLogicalInterfaceName('Vlanif100')).toBe(true);
      expect(isHuaweiStyleLogicalInterfaceName('NULL0')).toBe(true);
      expect(isHuaweiStyleLogicalInterfaceName('GE1/0/1')).toBe(false);
    });
  });
});
