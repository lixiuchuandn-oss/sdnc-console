import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: '数据验证失败',
      errors: err.errors,
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      message: '未授权访问',
    });
  }

  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      message: '资源未找到',
    });
  }

  return res.status(500).json({
    message: '服务器内部错误',
  });
};
