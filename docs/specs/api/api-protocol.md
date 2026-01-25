# API 通信规约与认证

## 1. 协议与数据格式

*   **传输协议**: 统一使用 HTTPS。
*   **数据格式**: 请求与响应均使用 JSON 格式 (`Content-Type: application/json;charset=utf-8`)。
*   **字符编码**: UTF-8。
*   **HTTP 方法**: 覆盖 `GET` (查询), `POST` (创建/执行), `PUT` (修改), `DELETE` (删除)。
*   **通用请求头**:
    *   `Content-Type: application/json;charset=utf-8`
    *   `X-Request-ID`: 请求唯一标识（建议客户端生成，用于链路追踪）。
    *   `Authorization`: 认证签名串。
    *   `tonce`: 时间戳（微秒）。

## 2. 认证机制 (HMAC-SHA256)

本平台采用 **HMAC-SHA256** 签名机制进行身份认证。

### 2.1 签名要素
*   `accesskey`: API 访问密钥 ID。
*   `secretkey`: API 访问密钥 Secret (仅用于本地签名，**严禁**在网络传输)。
*   `tonce`: 当前时间戳（微秒），与服务器时间偏差需 ≤ 300s。
*   `method`: HTTP 方法 (如 `GET`, `POST`)。
*   `url`: 请求的相对路径 (如 `/api/v1/resource`)。
*   `body`: 请求体内容的 MD5 值 (小写)。

### 2.2 签名串生成算法
```
sign_string = method + "|" + url + "|" + tonce + "|" + accesskey + "|" + query_params + "|" + MD5(body)
signature = HMAC-SHA256(sign_string, secretkey)
Authorization = Base64(accesskey + ":" + signature)
```

**详细规则**:
1.  **query_params**: 对于 `GET`/`DELETE` 请求，将 URL 查询参数按 key 排序后拼接（例如 `a=1&b=2`）；对于 `POST`/`PUT`，此项为空字符串。
2.  **body**: 对于 `POST`/`PUT` 请求，计算请求体 JSON 字符串的 MD5 (32位小写)；对于 `GET`/`DELETE`，此项为空字符串。
3.  **URL**: 即使包含查询参数，此处仅填写路径部分（Path）。

### 2.3 验证流程
服务端接收请求后，使用相同的算法利用本地存储的 `secretkey` 重新计算签名，并与请求头中的 `Authorization` 进行比对。若不一致或时间戳超时，则拒绝请求。

---

## 附录：Postman Pre-request Script (自动签名)

在 Postman 中使用以下脚本可自动生成 `Authorization` 和 `tonce` 头。

### 1. 通用 HMAC-SHA256 脚本
**前置条件**: 在 Postman Environment 中设置变量 `ACCESS_KEY`, `SECRET_KEY`, `BASE_URL`。

```javascript
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

### 2. 阿里云风格签名脚本 (HMAC-SHA1)
**前置条件**: 设置 `AccessKeyId`, `AccessKeySecret`。

```javascript
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
