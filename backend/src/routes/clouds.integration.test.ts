import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';

describe('cloud routes integration', () => {
  let app: Express;
  let dataSource: DataSource;
  let tempDir: string;
  let token: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compute-tower-clouds-'));
    process.env.DB_PATH = path.join(tempDir, 'integration.sqlite');
    process.env.DB_SYNC = 'true';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'cloud-routes-integration-secret';

    jest.resetModules();
    const database = await import('../config/database');
    const userEntity = await import('../entities/User');
    const cloudEntity = await import('../entities/Cloud');
    const appModule = await import('../index');

    app = appModule.app;
    dataSource = database.AppDataSource;
    await dataSource.initialize();

    const user = await dataSource.getRepository(userEntity.User).save({
      username: 'integration-admin',
      email: 'integration-admin@example.com',
      password: 'not-used-by-jwt-test',
      fullName: 'Integration Admin',
      role: userEntity.UserRole.SUPER_ADMIN,
      status: userEntity.UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    });
    token = jwt.sign(
      { userId: user.id, role: userEntity.UserRole.SUPER_ADMIN },
      process.env.JWT_SECRET,
    );

    await dataSource.getRepository(cloudEntity.Cloud).save({
      name: 'Integration Cloud',
      description: 'created by integration test',
      type: cloudEntity.CloudType.PRIVATE,
      status: cloudEntity.CloudStatus.ONLINE,
      region: 'default',
      endpoint: 'https://cloud.example.test',
      accessKey: 'ACCESS1234',
      secretKey: 'SECRET5678',
      config: { provider: 'cloudmap.private' },
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('responds to the health endpoint without authentication', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('OK');
  });

  it('rejects cloud list requests without a token', async () => {
    const res = await request(app).get('/api/clouds').expect(401);
    expect(res.body.message).toBe('未提供认证令牌');
  });

  it('returns redacted cloud pools for an authenticated super admin', async () => {
    const res = await request(app)
      .get('/api/clouds')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      name: 'Integration Cloud',
      type: 'private',
      status: 'online',
      accessKey: '***1234',
      secretKey: '***5678',
    });
  });
});
