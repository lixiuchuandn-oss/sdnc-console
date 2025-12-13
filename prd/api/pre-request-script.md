# Pre-request Script（签名与头生成）

- 目的：在客户端（如 Postman）为请求自动生成 `Authorization` 与 `tonce`。
- 安全建议：使用环境变量存放 `accesskey/secretkey`，避免硬编码；不要在脚本或仓库中提交真实密钥。

## 示例（HMAC-SHA256，Basic Auth）
```
// env: ACCESS_KEY, SECRET_KEY, BASE_URL
const baseUrl = pm.environment.get("BASE_URL");
const accesskey = pm.environment.get("ACCESS_KEY");
const secretkey = pm.environment.get("SECRET_KEY");

function md5Lower(s){ return CryptoJS.MD5(s || '').toString(); }
function ts16(){ return (Date.now() + '000').slice(0,16); }

const path = '/' + pm.request.url.path.join('/');
const method = pm.request.method;
const other = (['GET','DELETE'].includes(method))
  ? pm.request.url.query.toObject()
  : {};
const otherStr = Object.keys(other)
  .map(k => `${k}=${other[k]}`)
  .join('%26'); // encode '&'
const body = (['POST','PUT'].includes(method)) ? pm.request.body.raw || '' : '';

const tonce = ts16();
const sign = `${method}|${path}|${tonce}|${accesskey}|${otherStr}|${md5Lower(body)}`;
const signatureHash = CryptoJS.HmacSHA256(sign, secretkey).toString();
const auth = btoa(`${accesskey}:${signatureHash}`);

pm.environment.set('Authorization', auth);
pm.environment.set('tonce', tonce);
```

## 示例（阿里云签名 HMAC-SHA1）
```
// env: AccessKeyId, AccessKeySecret
function percentEncode(str){ return encodeURIComponent(str).replace(/\+/g,'%20').replace(/\*/g,'%2A').replace(/%7E/g,'~'); }
function uuid(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);}); }
function utcIsoNoMs(){ return new Date().toISOString().replace(/\.\d{3}Z$/,'Z'); }
(function(){
  const accessKeyId = pm.environment.get('AccessKeyId');
  const accessKeySecret = pm.environment.get('AccessKeySecret');
  const params = { Action:'DescribeVpcs', Version:'2014-05-26', Format:'JSON', AccessKeyId:accessKeyId, SignatureMethod:'HMAC-SHA1', SignatureNonce:uuid(), SignatureVersion:'1.0', Timestamp:utcIsoNoMs(), RegionId:'cn-shanghai' };
  const keys = Object.keys(params).sort();
  const canonicalized = keys.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  const crypto = require('crypto-js');
  const key = accessKeySecret + '&';
  const signature = crypto.HmacSHA1(stringToSign, key).toString(crypto.enc.Base64);
  pm.environment.set('Signature', signature);
  pm.environment.set('SignatureNonce', params.SignatureNonce);
  pm.environment.set('Timestamp', params.Timestamp);
})();
```

## 关联
- 通信规约与认证：`docs/api/communication.md`
- VR 控制器接口：`docs/api/vr.md`