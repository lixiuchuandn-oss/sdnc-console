package cn.com.rivercloud.util.response;

import com.alibaba.fastjson.JSONObject;

import java.util.Objects;

public class JsonResponseBuilder {

    private boolean success = true;

    private long errCode = 0;

    private String message = "";

    private Object data = new JSONObject();

    private Pagination pagination = null;

    public JsonResponseBuilder() {
    }

    public JsonResponseBuilder success(boolean success) {
        this.success = success;
        return this;
    }

    public JsonResponseBuilder errCode(int errCode) {
        this.errCode = errCode;
        return this;
    }

    public JsonResponseBuilder errCode(long errCode) {
        this.errCode = errCode;
        return this;
    }

    public JsonResponseBuilder message(String message) {
        this.message = message;
        return this;
    }

    public JsonResponseBuilder data(Object data) {
        this.data = data;
        return this;
    }

    public JsonResponseBuilder pagination(Pagination pagination) {
        this.pagination = pagination;
        return this;
    }

    public JSONObject build() {
        JSONObject result = new JSONObject();
        result.put("errCode", errCode);
        result.put("message", message);
        if (errCode != 0 && success) {
            success = false;
        }
        result.put("success", success);
        result.put("data", data);
        if (Objects.nonNull(pagination)) {
            result.put("pagination", pagination);
        }
        return result;
    }




}
