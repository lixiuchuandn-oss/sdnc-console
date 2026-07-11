package cn.com.rivercloud.controller;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import cn.com.rivercloud.bean.VrDeviceBean;
import cn.com.rivercloud.bean.vo.ReportConfigStatusVo;
import cn.com.rivercloud.service.VrInService;
import cn.com.rivercloud.util.common.RequestUtil;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import com.alibaba.fastjson.JSONObject;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description 南向接口
 */
@RestController
@RequestMapping("/V2/vrcontrol")
public class InVrController {

    @Resource
    private VrInService vrInService;

    /**
     * 注册VR虚机
     * @param request
     * @param vrDeviceBean
     * @return
     */
    @PostMapping("/VR1/register")
    public JSONObject register(HttpServletRequest request, @RequestBody @Validated VrDeviceBean vrDeviceBean) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrInService.register(result, vrDeviceBean);
    }

    /**
     * 注销VR虚机
     * @param request
     * @param uuid
     * @return
     */
    @DeleteMapping("/VR1/unregister")
    public JSONObject unregister(HttpServletRequest request, String uuid) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrInService.unregister(result, uuid);
    }

    /**
     * 校验合
     * @param request
     * @param uuid
     * @return
     */
    @GetMapping("/VR2/check-sum")
    public JSONObject checkSum(HttpServletRequest request, String uuid) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrInService.checkSum(result, uuid);
    }

    /**
     * 下载VR配置文件
     * @param response
     * @param uuid
     */
    @GetMapping("/VR2/download-config")
    public void download(HttpServletResponse response, String uuid) {
        vrInService.download(response, uuid);
    }

    /**
     * 上报VR配置生效状态
     * @param request
     * @param reportConfigStatusVo
     * @return
     */
    @PostMapping("/VR2/report-config-status")
    public JSONObject reportConfigStatus(HttpServletRequest request,
                                         @RequestBody @Validated ReportConfigStatusVo reportConfigStatusVo) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrInService.reportConfigStatus(result, reportConfigStatusVo);
    }

    /**
     * 上报VR配置和状态信息
     * @param request
     * @param vrConfigAndStatusBean
     * @return
     */
    @PostMapping("/VR3/active/config-and-Status")
    public JSONObject configAndStatus(HttpServletRequest request, @RequestBody VrConfigAndStatusBean vrConfigAndStatusBean) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrInService.configAndStatus(result, vrConfigAndStatusBean);
    }
}


