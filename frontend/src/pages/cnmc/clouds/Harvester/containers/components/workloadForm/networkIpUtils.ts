/**
 * 子网 CIDR / 静态 IP 可用性检测
 */

export const isIpInCidr = (ip: string, cidr: string): boolean => {
  try {
    const [cidrBase, prefixLenStr] = cidr.split('/');
    const prefixLen = parseInt(prefixLenStr, 10);
    
    if (!cidrBase || isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
      return false;
    }
    
    // 将 IP 转换为 32 位无符号整数（使用 >>> 0 确保无符号）
    const ipToNumber = (ipStr: string): number => {
      const parts = ipStr.split('.').map(p => parseInt(p, 10));
      if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        return -1;
      }
      // 使用无符号右移确保结果为正数
      return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
    };
    
    const ipNum = ipToNumber(ip);
    const cidrNum = ipToNumber(cidrBase);
    
    if (ipNum < 0 || cidrNum < 0) {
      return false;
    }
    
    // 计算掩码（无符号）
    const mask = prefixLen === 0 ? 0 : ((~0 << (32 - prefixLen)) >>> 0);
    
    // 检查网络地址是否相同（使用无符号运算）
    return ((ipNum & mask) >>> 0) === ((cidrNum & mask) >>> 0);
  } catch {
    return false;
  }
};

/**
 * 将 IP 地址转换为 32 位整数
 * @param ip IP 地址，如 "192.168.1.100"
 * @returns 32 位整数，无效返回 -1
 */
export const ipToNumber = (ip: string): number => {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  // 使用无符号右移确保结果为正数（避免 JavaScript 位运算溢出）
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
};

/**
 * 将 32 位整数转换为 IP 地址
 * @param num 32 位整数
 * @returns IP 地址字符串
 */
export const numberToIp = (num: number): string => {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
};

/**
 * 解析子网的已使用 IP 范围
 * Kube-OVN 子网 status.v4UsingIPrange 格式如 "10.1.1.2..10.1.1.10" 或数组形式
 * @param subnet 子网对象
 * @returns 已使用 IP 范围数组，每个元素为 { start, end }
 */
export const parseUsingIPRanges = (subnet: any): Array<{ start: number; end: number }> => {
  const status = subnet?.status || subnet?.rawData?.status || {};
  
  // 尝试多种字段名获取已使用IP范围
  let rangeStr = status.v4UsingIPrange || status.v4usingIPrange || status.usingIPrange;
  
  if (!rangeStr) {
    return [];
  }
  
  // 如果是数组形式
  if (Array.isArray(rangeStr)) {
    return rangeStr
      .map((r: string) => {
        const parts = String(r).split('..');
        if (parts.length === 2) {
          const start = ipToNumber(parts[0].trim());
          const end = ipToNumber(parts[1].trim());
          if (start >= 0 && end >= 0 && start <= end) {
            return { start, end };
          }
        }
        return null;
      })
      .filter((r): r is { start: number; end: number } => r !== null);
  }
  
  // 如果是字符串形式，可能是单个范围或多个范围用逗号分隔
  const ranges: Array<{ start: number; end: number }> = [];
  const parts = String(rangeStr).split(',');
  
  for (const part of parts) {
    const rangeParts = part.trim().split('..');
    if (rangeParts.length === 2) {
      const start = ipToNumber(rangeParts[0].trim());
      const end = ipToNumber(rangeParts[1].trim());
      if (start >= 0 && end >= 0 && start <= end) {
        ranges.push({ start, end });
      }
    }
  }
  
  return ranges;
};

/**
 * 检查 IP 是否在已使用 IP 范围内
 * @param ipNum IP 数值
 * @param ranges 已使用 IP 范围数组
 * @returns 是否已使用
 */
export const isIpInRanges = (ipNum: number, ranges: Array<{ start: number; end: number }>): boolean => {
  for (const range of ranges) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return true;
    }
  }
  return false;
};

/**
 * 解析子网的可用 IP 范围
 * Kube-OVN 子网 status.v4AvailableIPrange 格式如 "10.1.1.2..10.1.1.254" 或数组形式
 * @param subnet 子网对象
 * @returns 可用 IP 范围数组，每个元素为 { start, end }
 */
export const parseAvailableIPRanges = (subnet: any): Array<{ start: number; end: number }> => {
  const status = subnet?.status || subnet?.rawData?.status || {};
  const spec = subnet?.spec || subnet?.rawData?.spec || {};
  
  // 尝试多种字段名获取可用IP范围
  let rangeStr = status.v4AvailableIPrange || status.v4availableIPrange || status.availableIPrange;
  
  // 如果没有可用范围，尝试从 CIDR 计算（排除网关和广播地址）
  if (!rangeStr) {
    const cidr = spec.cidrBlock || subnet?.cidr || subnet?.spec?.cidrBlock;
    if (cidr) {
      // 从 CIDR 计算可用IP范围（简化版，不排除已使用的IP）
      // 这里只返回CIDR范围，实际检测需要后端API
      return [];
    }
    return [];
  }
  
  // 如果是数组形式
  if (Array.isArray(rangeStr)) {
    return rangeStr
      .map((r: string) => {
        const parts = String(r).split('..');
        if (parts.length === 2) {
          const start = ipToNumber(parts[0].trim());
          const end = ipToNumber(parts[1].trim());
          if (start >= 0 && end >= 0 && start <= end) {
            return { start, end };
          }
        }
        return null;
      })
      .filter((r): r is { start: number; end: number } => r !== null);
  }
  
  // 如果是字符串形式，可能是单个范围或多个范围用逗号分隔
  const ranges: Array<{ start: number; end: number }> = [];
  const parts = String(rangeStr).split(',');
  
  for (const part of parts) {
    const rangeParts = part.trim().split('..');
    if (rangeParts.length === 2) {
      const start = ipToNumber(rangeParts[0].trim());
      const end = ipToNumber(rangeParts[1].trim());
      if (start >= 0 && end >= 0 && start <= end) {
        ranges.push({ start, end });
      }
    }
  }
  
  return ranges;
};

/**
 * 检查 IP 是否在可用 IP 范围内
 * @param ip 要检查的 IP 地址
 * @param subnet 子网对象
 * @returns { available: boolean, reason: string, unknown?: boolean }
 */
export const checkIpAvailability = (ip: string, subnet: any): { available: boolean; reason: string; unknown?: boolean } => {
  const ipNum = ipToNumber(ip);
  if (ipNum < 0) {
    return { available: false, reason: 'IP 地址格式无效' };
  }
  
  // 先检查是否在已使用IP范围内
  const usingRanges = parseUsingIPRanges(subnet);
  if (usingRanges.length > 0 && isIpInRanges(ipNum, usingRanges)) {
    const usingDesc = usingRanges.map(r => `${numberToIp(r.start)}..${numberToIp(r.end)}`).join(', ');
    return { available: false, reason: `IP 已被使用。已使用范围: ${usingDesc}` };
  }
  
  // 再检查可用IP范围
  const availableRanges = parseAvailableIPRanges(subnet);
  
  if (availableRanges.length === 0) {
    // 如果有已使用范围但没有可用范围，说明可以尝试（不在已使用范围中）
    if (usingRanges.length > 0) {
      return { available: true, reason: 'IP 不在已使用范围内，可以尝试分配' };
    }
    // 都没有，返回未知状态
    return { available: false, reason: '无法检测IP可用性：子网未提供可用IP范围信息。请确保该IP未被其他工作负载使用。', unknown: true };
  }
  
  // 检查 IP 是否在任一可用范围内
  for (const range of availableRanges) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return { available: true, reason: `IP 在可用范围内 (${numberToIp(range.start)}..${numberToIp(range.end)})` };
    }
  }
  
  // IP 不在任何可用范围内，说明已被使用或被排除
  const rangeDesc = availableRanges.map(r => `${numberToIp(r.start)}..${numberToIp(r.end)}`).join(', ');
  return { available: false, reason: `IP 不在可用范围内。可用范围: ${rangeDesc}` };
};
