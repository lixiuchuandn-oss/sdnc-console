package cn.com.rivercloud.sign;

import cn.com.rivercloud.util.common.SignAtureUtil;
import com.alibaba.fastjson.JSONObject;
import org.springframework.web.bind.annotation.*;

/**
 * description: SignTest <br>
 * date: 2021/7/19 14:01 <br>
 * version: 1.0 <br>
 * @author 温高峰
 */
@RestController
@RequestMapping("/api/sign")
public class SignTest {

    /**
     * 获取测试用第三方鉴权sign
     */
    @PostMapping
    public JSONObject getSign(@RequestParam(value = "url")String url,
                              @RequestParam(value = "method")String method,
                              @RequestParam(value = "other",required = false)String other,
                              @RequestBody(required = false) String body,
                              @RequestParam(value = "accessKey")String accessKey,
                              @RequestParam(value = "secretKey")String secretKey) {

        return SignAtureUtil.getSign(url, method, other, body,accessKey,secretKey);
    }
}
