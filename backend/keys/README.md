# License 签发密钥（RS256）

| 文件 | 入库 | 用途 |
|------|------|------|
| `license-signing-public.pem` | 是 | 与 `src/config/licenseSigning.ts` 内置公钥一致；部署侧验签 |
| `license-signing-private.pem` | **否**（.gitignore） | 仅授权中心/本机 `scripts/generateLicense.ts` 签发 |

重新生成密钥对（在 `backend` 目录）：

```bash
node -e "const c=require('crypto');const fs=require('fs');const {publicKey,privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});fs.writeFileSync('keys/license-signing-private.pem',privateKey);fs.writeFileSync('keys/license-signing-public.pem',publicKey);"
```

生成后须把公钥 PEM 同步进 `src/config/licenseSigning.ts` 的 `EMBEDDED_LICENSE_PUBLIC_KEY_PEM`，并重新发版。
