import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Result, Button } from 'antd';
import { isChunkLoadError, tryAutoReloadOnChunkError } from '../utils/chunkLoadError';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * 全局错误边界组件
 * 捕获子组件树中的 JavaScript 错误，记录错误并显示降级 UI
 * 
 * 使用方式：
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (tryAutoReloadOnChunkError(error)) return;

    // 记录错误信息（可以发送到错误监控服务）
    console.error('Error caught by boundary:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // TODO: 可以在这里集成错误监控服务（如 Sentry）
    // if (window.Sentry) {
    //   window.Sentry.captureException(error, { contexts: { react: errorInfo } });
    // }
  }

  handleReset = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认错误 UI
      return (
        <Result
          status="500"
          title="页面出现错误"
          subTitle={
            <div>
              <p>{this.state.error?.message || '发生了未知错误'}</p>
              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <details style={{ marginTop: 16, textAlign: 'left' }}>
                  <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
                    错误详情（开发模式）
                  </summary>
                  <pre
                    style={{
                      background: '#f5f5f5',
                      padding: 12,
                      borderRadius: 4,
                      overflow: 'auto',
                      fontSize: 12,
                    }}
                  >
                    {this.state.error?.stack}
                    {'\n\n'}
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          }
          extra={[
            <Button type="primary" key="reload" onClick={this.handleReload}>
              刷新页面
            </Button>,
            <Button key="reset" onClick={this.handleReset}>
              重试
            </Button>,
          ]}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
