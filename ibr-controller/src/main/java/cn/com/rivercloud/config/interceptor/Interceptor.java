package cn.com.rivercloud.config.interceptor;

import cn.com.rivercloud.config.warpper.ApiHttpServletRequestWrapper;
import cn.com.rivercloud.util.common.PubMethod;
import cn.com.rivercloud.util.common.RequestUtil;
import cn.com.rivercloud.util.common.SignAtureUtil;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import cn.com.rivercloud.util.result.ApiResult;
import cn.com.rivercloud.util.result.ApiResultCode;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Enumeration;

/**
 * 拦截器实现 WGF
 * 第三方Api 基于Basic Authentication 的请求
 * 请求接口规范为RESTAPI GET/POST/PUT/DELETE/ 可能还有空的OPTION
 *
 * @author 温高峰
 */
@Slf4j
@Component
public class Interceptor implements HandlerInterceptor {

    @Value("${ACCESS_KEY:admin}")
    private String ACCESS_KEY;
    @Value("${SECRET_KEY:admin}")
    private String SECRET_KEY;

    @Value("${telecomUrl}")
    private String telecomUrl;

    /**
     * description: preHandle <br>
     * version: 1.0 <br>
     * date: 2021/7/9 18:12 <br>
     * author: objcat <br>
     *
     * @param request  HttpServletRequest
     * @param response HttpServletResponse
     * @param handler  Handler
     * @return boolean
     */
    @Override
    public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response, @NonNull Object handler) {
        log.info("拦截url---");
        try {
            //获取请求body
            ApiHttpServletRequestWrapper requestWrapper = new ApiHttpServletRequestWrapper(request);
            String body = requestWrapper.getBody();
            StringBuffer url = requestWrapper.getRequestURL();

            //获取请求参数
            Enumeration params = request.getParameterNames();
            StringBuilder paramsStrB = new StringBuilder();
            while (params.hasMoreElements()) {
                if (PubMethod.isEmpty(paramsStrB.toString())) {
                    paramsStrB.append("?");
                }

                String paramName = params.nextElement().toString();
                paramsStrB.append(paramName).append("=").append(request.getParameter(paramName)).append("&");
            }

            //去掉最后一个&
            String paramsStr = "";
            if (!PubMethod.isEmpty(paramsStrB.toString())) {
                paramsStr = paramsStrB.toString().substring(0, paramsStrB.toString().length() - 1);
            }

            // 读取 X-Real-IP 或 X-Forwarded-For 头
            String realIp = request.getHeader("X-Real-IP");
            String forwardedFor = request.getHeader("X-Forwarded-For");
            // 选择使用的 IP 地址
            String clientIp = (realIp != null ? realIp : (forwardedFor != null ? forwardedFor.split(",")[0].trim() : request.getRemoteAddr()));
            log.info("源IP {} 请求URL为: {}{}，body为：{}", clientIp, url, paramsStr.toString(), body);

            //如果认证签名关闭，或者是内部接口调用则跳过签名验证
            if (StringUtils.isBlank(telecomUrl) || url.toString().contains("/inner/api/V2")) {
                return true;
            }

            //获取header时间戳和当前时间戳
            String reqTonce = request.getHeader("tonce");
            if (StringUtils.isBlank(reqTonce)) {
                log.error(ApiResultCode.P10001.message());

                String result;
                if (url.toString().contains("/V2")) {
                    ApiPageModeResult result2 = RequestUtil.requestId(request);
                    result = result2.code(ApiResultCode.P10001.code()).msg(ApiResultCode.P10001.message()).build().toJSONString();
                } else {
                    result = ApiResult.failureDataMsg(ApiResultCode.P10001, ApiResultCode.P10001.message()).build().toJSONString();
                }

                returnJson(response, result);
                return false;
            }
            long time = Long.parseLong(reqTonce);
            long sysTonce = System.currentTimeMillis() * 1000;
            //校验时间戳是否在300秒之内
            long a = (sysTonce - time) / 1000000;
            log.info("时间差:{}", a);
            if ((sysTonce - time) / 1000000 > 10000) {
                //统一返回结构 、、请求超时
                log.error(ApiResultCode.P10002.message());

                String result;
                if (url.toString().contains("/V2")) {
                    ApiPageModeResult result2 = RequestUtil.requestId(request);
                    result = result2.code(ApiResultCode.P10002.code()).msg(ApiResultCode.P10002.message()).build().toJSONString();
                } else {
                    result = ApiResult.failureDataMsg(ApiResultCode.P10002, ApiResultCode.P10002.message()).build().toJSONString();
                }

                returnJson(response, result);
                return false;
            }
            //获取认证头Authorization信息
            String authCode = request.getHeader("Authorization");
            //校验认证头
            if (StringUtils.isBlank(authCode)) {
                //统一返回结构 -- 请求头字段缺失
                log.error(ApiResultCode.P10003.message());
                String result;
                if (url.toString().contains("/V2")) {
                    ApiPageModeResult result2 = RequestUtil.requestId(request);
                    result = result2.code(ApiResultCode.P10003.code()).msg(ApiResultCode.P10003.message()).build().toJSONString();
                } else {
                    result = ApiResult.failureDataMsg(ApiResultCode.P10003, ApiResultCode.P10003.message()).build().toJSONString();
                }

                returnJson(response, result);
                return false;
            }
            log.info("请求头Authorization信息:{}", authCode);
            //对认证头信息进行base64解码
            String s = new String(Base64.getDecoder().decode(authCode), StandardCharsets.UTF_8);
            log.info("解码后的请求头Authorization信息:{}", s);
            //accessKey 截取 : 字符串之前的字符
            String accessKey = StringUtils.substringBefore(s, ":");
            //signature_hash 截取 : 字符串之后的字符
            String signature_hash = StringUtils.substringAfter(s, ":");
            log.info("signature_hash:{}", signature_hash);
            //校验accessKey
            if (!ACCESS_KEY.equals(accessKey)) {
                //统一返回结构 --校验用户名称 accessKey错误 401 无权限
                log.error("请求体中accessKey={},应该为：{}", accessKey, ACCESS_KEY);

                String result;
                if (url.toString().contains("/V2")) {
                    ApiPageModeResult result2 = RequestUtil.requestId(request);
                    result = result2.code(ApiResultCode.P10004.code()).msg(ApiResultCode.P10004.message()).build().toJSONString();
                } else {
                    result = ApiResult.failureDataMsg(ApiResultCode.P10004, ApiResultCode.P10004.message()).build().toJSONString();
                }

                returnJson(response, result);
                return false;
            }
            //获取请求参数
            String queryString = request.getQueryString();
            //request.
            //获取请求类型
            String requestURI = request.getRequestURI();
            //获取请求方法
            String method = request.getMethod();
            log.info("请求参数:{},{},{}", queryString, requestURI, method);

            //对数据进行加密处理
            //method|url|tonce|accesskey|other|MD5(body)
            StringBuilder signStr = new StringBuilder();
            signStr.append(method).append("|")
                    .append(requestURI).append("|")
                    .append(time).append("|")
                    .append(ACCESS_KEY);
            //请求参数-other
            if (StringUtils.isNotBlank(queryString)) {
                signStr.append("|")
                        .append(queryString);
            } else {
                signStr.append("|");
            }
            //请求参数-body md5加密
            if (StringUtils.isNotBlank(body)) {
                signStr.append("|")
                        .append(DigestUtils.md5Hex(body));
            } else {
                signStr.append("|");
            }
            //signStr.append(SECRET_KEY);
            log.info("最终拼接的str：{}", signStr);
            //加密参数用于对比校验
            String sha256Str = SignAtureUtil.sha256_HMAC(signStr.toString(), SECRET_KEY);
            log.info("sha256Str加密后的str：{}，入参的STR{}", sha256Str, signature_hash);
            if (!sha256Str.equals(signature_hash)) {
                //统一返回结构
                log.error(ApiResultCode.P10005.message() + "，原因：入参 :" + signature_hash + "加密不对");

                String result;
                if (url.toString().contains("/V2")) {
                    ApiPageModeResult result2 = RequestUtil.requestId(request);
                    result = result2.code(ApiResultCode.P10005.code()).msg(ApiResultCode.P10005.message()).build().toJSONString();
                } else {
                    result = ApiResult.failureDataMsg(ApiResultCode.P10005, ApiResultCode.P10005.message()).build().toJSONString();
                }

                returnJson(response, result);
                return false;
            }
            //校验signature_hash成功
            return true;
        } catch (Exception e) {
            String result = ApiResult.failure().build().toJSONString();
            returnJson(response, result);
            return false;
        }
    }

    /**
     * 返回客户端数据
     */
    private void returnJson(HttpServletResponse response, String result) {
        PrintWriter writer = null;
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json; charset=utf-8");
        try {
            writer = response.getWriter();
            writer.print(result);
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            if (writer != null) {
                writer.close();
            }
        }

    }

    /**
     * 处理请求完成后视图渲染之前的处理操作
     *
     * @param httpServletRequest  Servlet
     * @param httpServletResponse Servlet
     * @param o                   OBJECT
     * @param modelAndView        view
     * @throws Exception e
     */
    @Override
    public void postHandle(@NonNull HttpServletRequest httpServletRequest, @NonNull HttpServletResponse httpServletResponse, @NonNull Object o, ModelAndView modelAndView) throws Exception {

    }


    /**
     * 视图渲染之后的操作
     *
     * @param httpServletRequest  Servlet
     * @param httpServletResponse Servlet
     * @param o                   OBJECT
     * @throws Exception e
     */
    @Override
    public void afterCompletion(@NonNull HttpServletRequest httpServletRequest, @NonNull HttpServletResponse httpServletResponse, @NonNull Object o, Exception e) throws Exception {

    }
}


