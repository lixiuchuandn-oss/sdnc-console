import { Router, Request, Response } from 'express';
import { generateKeyPair } from 'crypto';

const router = Router();

/**
 * [API] 生成 SSH 密钥对
 * GET /api/tools/ssh-keygen
 */
router.get('/ssh-keygen', async (req: Request, res: Response) => {
  try {
    // Generate as DER to avoid PEM parsing issues and for efficiency
    generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'pkcs1',
          format: 'der', // Generate DER directly
        },
        privateKeyEncoding: {
          type: 'pkcs1',
          format: 'pem', // Keep private key as PEM
        },
      },
      (err, publicKeyDer, privateKey) => {
        if (err) {
          console.error('Key generation failed:', err);
          return res.status(500).json({ message: '密钥生成失败', error: err.message });
        }

        try {
          // Convert PKCS#1 DER to OpenSSH format
          // We have the raw RSAPublicKey DER buffer
          const sshKey = convertRsakeyDerToOpenSsh(publicKeyDer as Buffer);

          res.json({
            publicKey: sshKey,
            privateKey: privateKey,
          });
        } catch (e: any) {
          console.error('Conversion failed:', e);
          res.status(500).json({ message: '密钥格式转换失败', error: e.message });
        }
      },
    );
  } catch (error: any) {
    res.status(500).json({ message: '内部错误', error: error.message });
  }
});

// Helper to convert RSAPublicKey DER to OpenSSH public key format
// NOTE: Input MUST be PKCS#1 DER (RSAPublicKey), NOT SPKI!
function convertRsakeyDerToOpenSsh(pkcs1Der: Buffer): string {
  // RSAPublicKey structure:
  // SEQUENCE { modulus INTEGER, publicExponent INTEGER }

  // Helper to read ASN.1 integer
  let offset = 0;
  function readDerLength(buf: Buffer) {
    let len = buf[offset++];
    if (len & 0x80) {
      const bytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < bytes; i++) {
        len = (len << 8) | buf[offset++];
      }
    }
    return len;
  }

  function readDerInteger(buf: Buffer): Buffer {
    const _tag = buf[offset++]; // 0x02
    const len = readDerLength(buf);
    return buf.slice(offset, (offset += len));
  }

  // Reset offset for new buffer
  offset = 0;

  // Skip SEQUENCE tag and length
  const _seqTag = pkcs1Der[offset++]; // 0x30
  const _seqLen = readDerLength(pkcs1Der);

  const modulus = readDerInteger(pkcs1Der);
  const exponent = readDerInteger(pkcs1Der);

  // Helper to write SSH mpint/string
  function writeSshBuffer(buf: Buffer): Buffer {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(buf.length);
    return Buffer.concat([lenBuf, buf]);
  }

  function writeSshMpint(buf: Buffer): Buffer {
    // If MSB is set, prepend 0x00 to make it positive
    if (buf[0] & 0x80) {
      const pad = Buffer.alloc(1, 0);
      return writeSshBuffer(Buffer.concat([pad, buf]));
    }
    // For RSA modulus, it's always positive.
    return writeSshBuffer(buf);
  }

  const typeStr = Buffer.from('ssh-rsa');
  // Order for ssh-rsa is: type, e, n (exponent, modulus) per RFC 4253 section 6.6
  const sshBlob = Buffer.concat([
    writeSshBuffer(typeStr),
    writeSshMpint(exponent),
    writeSshMpint(modulus),
  ]);

  const base64Body = sshBlob.toString('base64');
  return `ssh-rsa ${base64Body} generated-key`;
}

export const toolRoutes = router;
