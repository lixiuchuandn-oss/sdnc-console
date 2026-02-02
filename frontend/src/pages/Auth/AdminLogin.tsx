import React, { useState, useEffect, useRef } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getDefaultAdminPath } from '../../utils/accessMapping';
import './Login.css';

const AdminLogin: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [form] = Form.useForm();
  const { login } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const loggedInUser = await login(values.username, values.password);
      message.success('登录成功');
      const role = String((loggedInUser as any)?.role || '').toLowerCase();
      if (role === 'super_admin' || role === 'admin') {
        navigate('/admin/dashboard');
        return;
      }
      const perms = Array.isArray((loggedInUser as any).permissions) ? (loggedInUser as any).permissions : [];
      const target = getDefaultAdminPath(perms);
      navigate(target);
    } catch (error) {
      message.error('登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  const onFinishFailed = (errorInfo: any) => {
    console.log('表单验证失败:', errorInfo);
  };

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const containerEl = containerRef.current;
    if (!canvasEl || !containerEl) return;
    const ctxEl = canvasEl.getContext('2d');
    if (!ctxEl) return;
    const canvasNN = canvasEl as HTMLCanvasElement;
    const containerNN = containerEl as HTMLDivElement;
    const ctxNN = ctxEl as CanvasRenderingContext2D;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      w = containerNN.clientWidth;
      h = containerNN.clientHeight;
      canvasNN.width = Math.floor(w * dpr);
      canvasNN.height = Math.floor(h * dpr);
      canvasNN.style.width = w + 'px';
      canvasNN.style.height = h + 'px';
      ctxNN.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    let cell = Math.max(6, Math.floor(Math.sqrt((w * h) / 10000)));
    let cols = Math.ceil(w / cell);
    let rows = Math.ceil(h / cell);
    let t = 0;
    let raf = 0;
    const seed = Math.random() * 1000;
    const rand = (ix: number, iy: number) => {
      const v = Math.sin(ix * 127.1 + iy * 311.7 + seed) * 43758.5453;
      return v - Math.floor(v);
    };
    const smoothstep = (u: number) => u * u * (3 - 2 * u);
    const vnoise = (x: number, y: number) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const sx = smoothstep(x - x0);
      const sy = smoothstep(y - y0);
      const n00 = rand(x0, y0);
      const n10 = rand(x1, y0);
      const n01 = rand(x0, y1);
      const n11 = rand(x1, y1);
      const ix0 = n00 + (n10 - n00) * sx;
      const ix1 = n01 + (n11 - n01) * sx;
      return ix0 + (ix1 - ix0) * sy;
    };
    const fbm = (x: number, y: number, tt: number) => {
      let sum = 0;
      let amp = 0.5;
      let freq = 1;
      for (let i = 0; i < 4; i++) {
        sum += amp * vnoise(x * freq + tt * 0.35, y * freq - tt * 0.28);
        amp *= 0.5;
        freq *= 2;
      }
      return sum;
    };
    function step() {
      ctxNN.clearRect(0, 0, w, h);
      t += 0.02;
      for (let iy = 0; iy < rows; iy++) {
        const y = iy * cell;
        for (let ix = 0; ix < cols; ix++) {
          const x = ix * cell;
          const nx = x / w;
          const ny = y / h;
          const v = fbm(nx * 5, ny * 5, t);
          const m0 = Math.max(0, Math.min(1, v));
          const m = m0 * m0 * (3 - 2 * m0);
          const br = 16, bg = 98, bb = 254;
          const r = Math.round(br + (255 - br) * m);
          const g = Math.round(bg + (255 - bg) * m);
          const b = Math.round(bb + (255 - bb) * m);
          ctxNN.fillStyle = `rgb(${r},${g},${b})`;
          ctxNN.fillRect(x, y, cell, cell);
        }
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    const onResize = () => {
      resize();
      cell = Math.max(6, Math.floor(Math.sqrt((w * h) / 10000)));
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="login-container" ref={containerRef}>
      <canvas className="particle-canvas" ref={canvasRef} />
      <div className="login-content">
        <div className="login-header">
          <h1 className="login-title">Compute Tower</h1>
          <p className="login-subtitle">后台管理登录</p>
        </div>
        <Card className="login-card" variant="borderless" style={{ backgroundColor: 'rgba(255, 255, 255, 0.6)' }}>
          <Form
            form={form}
            name="login"
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            onValuesChange={(changed, all)=>{
              console.log('值变化', changed, all, 'get', form.getFieldValue('username'), form.getFieldValue('password'));
            }}
            autoComplete="off"
            size="large"
          >
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名!' }]}><Input prefix={<UserOutlined />} placeholder="用户名或邮箱" autoComplete="username"/></Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码!' }]}><Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password"/></Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">登录</Button>
            </Form.Item>
          </Form>
        </Card>
        <div className="login-footer"><p>© 2024 Cloudmap</p></div>
      </div>
    </div>
  );
};

export default AdminLogin;