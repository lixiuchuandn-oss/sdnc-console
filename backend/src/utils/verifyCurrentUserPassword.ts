import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';

export type VerifyCurrentUserPasswordResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

/** 校验当前登录用户密码（与 clouds reveal 等敏感操作一致） */
export async function verifyCurrentUserPassword(
  user: { id: string; password?: string } | undefined,
  password: unknown,
): Promise<VerifyCurrentUserPasswordResult> {
  const plain = String(password ?? '').trim();
  if (!plain) {
    return { ok: false, status: 400, message: '请输入管理员密码' };
  }
  if (!user?.id) {
    return { ok: false, status: 401, message: '未登录' };
  }

  let hash = user.password;
  if (!hash) {
    const fullUser = await AppDataSource.getRepository(User).findOne({
      where: { id: user.id },
      select: ['password'],
    });
    hash = fullUser?.password;
  }
  if (!hash) {
    return { ok: false, status: 500, message: '无法获取用户信息' };
  }

  const isMatch = await bcrypt.compare(plain, hash);
  if (!isMatch) {
    return { ok: false, status: 403, message: '密码错误' };
  }
  return { ok: true };
}
