import cronstrue from 'cronstrue/i18n';

/**
 * Maps hour (0-23) to Chinese period string.
 */
function getPeriod(hour: number): string {
  if (hour >= 0 && hour <= 5) return '凌晨';
  if (hour >= 6 && hour <= 8) return '早晨';
  if (hour >= 9 && hour <= 11) return '上午';
  if (hour === 12) return '中午';
  if (hour >= 13 && hour <= 18) return '下午';
  return '晚上';
}

/**
 * Formats a cron expression into a human-readable Chinese string
 * matching specific UX requirements (e.g. "每天凌晨 2:00 执行").
 */
export function formatCron(cron: string): string {
  if (!cron || cron === '-') return '-';

  try {
    const parts = cron.trim().split(/\s+/);
    // Standard cron has 5 fields: min hour dom month dow
    // Optional 6th field (year) or seconds (if 6 fields, usually seconds is first).
    // Harvester/K8s usually 5 fields.
    // If 6 fields, assume seconds first: sec min hour dom month dow
    
    let min = '', hour = '', dom = '', month = '', dow = '';
    
    if (parts.length === 5) {
      [min, hour, dom, month, dow] = parts;
    } else if (parts.length === 6) {
      // Assume first is seconds, ignore it for text description if 0
      [, min, hour, dom, month, dow] = parts;
    } else {
      // Fallback for non-standard length
      return cronstrue.toString(cron, { locale: 'zh_CN', use24HourTimeFormat: true });
    }

    // Check for "Simple Time" pattern: specific min/hour, wildcards for dom/month
    const isTimeSet = /^\d+$/.test(min) && /^\d+$/.test(hour);
    const isDaily = dom === '*' && month === '*' && dow === '*';
    const isWeekly = dom === '*' && month === '*' && /^\d+$/.test(dow); // Specific day of week
    const isWeekdays = dom === '*' && month === '*' && (dow === '1-5');

    if (isTimeSet) {
      const h = parseInt(hour, 10);
      const m = parseInt(min, 10).toString().padStart(2, '0');
      const period = getPeriod(h);
      const timeStr = `${period} ${h}:${m}`;

      if (isDaily) {
        return `每天${timeStr} 执行`;
      }

      if (isWeekly) {
        // Map dow number to Chinese day
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        const d = parseInt(dow, 10);
        const dayStr = days[d] || days[0]; // 0 and 7 are Sunday
        return `每${dayStr}${timeStr} 执行`;
      }

      if (isWeekdays) {
        return `工作日(周一至周五) ${timeStr} 执行`;
      }
    }

    // Interval pattern: */N
    if (hour.startsWith('*/') && min === '0' && dom === '*' && month === '*' && dow === '*') {
      const interval = hour.substring(2);
      return `每隔 ${interval} 小时执行一次`;
    }

    // Fallback to cronstrue for complex patterns
    // Use 24h format to avoid "At 02:00 PM" style if possible, though zh_CN might still add descriptors.
    // cronstrue zh_CN often returns "在 14:00" or "每 2 小时".
    let result = cronstrue.toString(cron, { locale: 'zh_CN', use24HourTimeFormat: true });
    
    // Clean up "At / 在" prefix if present
    if (result.startsWith('在 ')) {
      result = result.substring(2);
    }
    
    // Add "执行" suffix if not present and sounds natural
    // (This is heuristic)
    if (!result.endsWith('执行') && !result.endsWith('次')) {
        // Only append if it looks like a time point, not an interval "Every minute"
        result += ' 执行';
    }

    return result;

  } catch (e) {
    console.warn('Cron format error:', e);
    return cron;
  }
}
