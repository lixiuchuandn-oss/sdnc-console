package cn.com.rivercloud.util.exception;

import cn.com.rivercloud.util.common.RequestUtil;
import cn.com.rivercloud.util.result.ApiResultCode;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.BindException;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import javax.servlet.http.HttpServletRequest;
import javax.validation.ConstraintViolationException;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BindException.class)
    public JSONObject handleBindException(HttpServletRequest request, BindException e) {
        BindingResult bindingResult = e.getBindingResult();
        StringBuilder sb = new StringBuilder();
        for (FieldError fieldError : bindingResult.getFieldErrors()) {
            sb.append(fieldError.getDefaultMessage()).append(", ");
        }
        String msg = sb.toString();
        log.error("BindException occurred: {}", e.getMessage(), e);
        return RequestUtil.requestId(request).code(ApiResultCode.VM19000.code()).msg(msg).build();
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public JSONObject handleMethodArgumentNotValidException(HttpServletRequest request,
                                                            MethodArgumentNotValidException e) {
        BindingResult bindingResult = e.getBindingResult();
        StringBuilder sb = new StringBuilder();
        for (FieldError fieldError : bindingResult.getFieldErrors()) {
            sb.append(fieldError.getDefaultMessage()).append(", ");
        }
        String msg = sb.toString();
        log.error("MethodArgumentNotValidException occurred: {}", e.getMessage(), e);
        return RequestUtil.requestId(request).code(ApiResultCode.NULL.code()).msg(msg).build();
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public JSONObject handleConstraintViolationException(HttpServletRequest request, ConstraintViolationException e) {
        log.error("ConstraintViolationException occurred: {}", e.getMessage(), e);
        return RequestUtil.requestId(request).code(ApiResultCode.NULL.code()).msg(e.getMessage()).build();
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public JSONObject handleMissingServletRequestParameterException(HttpServletRequest request,
                                                                    MissingServletRequestParameterException e) {
        log.error("MissingServletRequestParameterException occurred: {}", e.getMessage(), e);
        return RequestUtil.requestId(request).code(ApiResultCode.NULL.code()).msg(e.getMessage()).build();
    }

    @ExceptionHandler(value = ServiceException.class)
    public JSONObject handleServiceException(HttpServletRequest request, ServiceException e) {
        log.error("ServiceException occurred: {}", e.getMessage(), e);
        return RequestUtil.requestId(request)
                .code(e.getErrCode() == null ? 500 : Integer.parseInt(e.getErrCode()))
                .msg(handleExceptionMsg(e.getMessage())).build();
    }

    @ExceptionHandler(value = Exception.class)
    public JSONObject handleException(HttpServletRequest request, Exception e) {
        log.error("Exception occurred: {}", e.getMessage(), e);
        return RequestUtil.requestId(request)
                .code(ApiResultCode.INTERNAL_SERVER_ERROR.code())
                .msg(ApiResultCode.INTERNAL_SERVER_ERROR.message())
                .build();
    }

    /**
     * 将异常信息中exception部分去掉
     * @param originMsg
     * @return
     */
    private String handleExceptionMsg(String originMsg) {
        if (originMsg.contains("Exception: ")) {
            String targetString = "Exception: ";
            int exceptionIndex = originMsg.indexOf(targetString);
            return originMsg.substring(exceptionIndex + targetString.length());
        }
        return originMsg;
    }
}
