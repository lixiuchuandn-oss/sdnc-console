package cn.com.rivercloud.config.filter;

import cn.com.rivercloud.config.warpper.ApiHttpServletRequestWrapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.servlet.*;
import javax.servlet.annotation.WebFilter;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;

/**
 * 过滤器 -wgf
 * 对API接口进行过滤
 * 将request传递下去
 *
 * @author 温高峰
 */
@WebFilter(urlPatterns = {"/V1.0/ctcontrol/*", "/V2/ctcontrol/*","/v1/service/*"}, filterName = "channelFilter")
@Component
@Order(1)
@Slf4j
public class ChannelFilter implements Filter {
    private static final String FORM_CONTENT_TYPE = "multipart/form-data";

    @Override
    public void init(FilterConfig filterConfig) {
        log.info("初始化filter===!");
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain) throws IOException, ServletException {

        ServletRequest requestWrapper = null;
        String contentType = servletRequest.getContentType();
        if (servletRequest instanceof HttpServletRequest) {
            requestWrapper = new ApiHttpServletRequestWrapper((HttpServletRequest) servletRequest);
        }
        boolean ex = null == requestWrapper || (contentType != null && contentType.contains(FORM_CONTENT_TYPE));
        if (ex) {
            filterChain.doFilter(servletRequest, servletResponse);
        } else {
            filterChain.doFilter(requestWrapper, servletResponse);
        }
    }

    @Override
    public void destroy() {
        log.info("销毁filter===!");
    }
}