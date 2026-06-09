import bcrypt from 'bcryptjs';

/** 生成 Docker Registry htpasswd 文件内容（bcrypt） */
export function buildRegistryHtpasswdLine(username: string, password: string): string {
  const hash = bcrypt.hashSync(password, 10);
  return `${username}:${hash}\n`;
}

/** Kubernetes Secret data.HTPASSWD 字段（base64 编码的 htpasswd 文件） */
export function encodeRegistryHtpasswdSecret(username: string, password: string): string {
  return Buffer.from(buildRegistryHtpasswdLine(username, password), 'utf-8').toString('base64');
}

export function buildRegistryBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/** Kubernetes Secret data['.dockerconfigjson']（base64 编码） */
export function encodeRegistryDockerConfigSecret(
  server: string,
  username: string,
  password: string,
  email?: string,
): string {
  const registryHost = server.replace(/^https?:\/\//, '').split('/')[0];
  const authString = Buffer.from(`${username}:${password}`).toString('base64');
  const dockerConfig = {
    auths: {
      [registryHost]: {
        username,
        password,
        auth: authString,
        ...(email ? { email } : {}),
      },
    },
  };
  return Buffer.from(JSON.stringify(dockerConfig), 'utf-8').toString('base64');
}
