package cn.com.rivercloud.util.common;

import cn.com.rivercloud.util.result.ApiPageModeResult;

import javax.servlet.http.HttpServletRequest;

public class RequestUtil {

    public static ApiPageModeResult requestId(HttpServletRequest request){
        String header = request.getHeader("X-Request-ID");
        return new ApiPageModeResult().requestId(header);
    }
}
