const cronstrue = require('cronstrue/i18n');

const cron = '0 2 * * *';

console.log('Default:', cronstrue.toString(cron, { locale: 'zh_CN' }));
console.log('Verbose:', cronstrue.toString(cron, { locale: 'zh_CN', verbose: true }));
console.log('24h:', cronstrue.toString(cron, { locale: 'zh_CN', use24HourTimeFormat: true }));
console.log('Verbose + 24h:', cronstrue.toString(cron, { locale: 'zh_CN', verbose: true, use24HourTimeFormat: true }));
