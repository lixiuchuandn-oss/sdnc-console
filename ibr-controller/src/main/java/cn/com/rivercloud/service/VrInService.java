package cn.com.rivercloud.service;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import cn.com.rivercloud.bean.VrDeviceBean;
import cn.com.rivercloud.bean.vo.ReportConfigStatusVo;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import com.alibaba.fastjson.JSONObject;

import javax.servlet.http.HttpServletResponse;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description
 */
public interface VrInService {

    /**
     * 注册VR虚机
     * @param result
     * @param vrDeviceBean
     * @return
     */
    JSONObject register(ApiPageModeResult result,  VrDeviceBean vrDeviceBean);

    /**
     * 注销VR虚机
     * @param result
     * @param uuid
     * @return
     */
    JSONObject unregister(ApiPageModeResult result, String uuid);

    /**
     * 校验合
     * @param result
     * @param uuid
     * @return
     */
    JSONObject checkSum(ApiPageModeResult result,  String uuid);

    /**
     * 下载VR配置文件
     * @param response
     * @param uuid
     */
    void download(HttpServletResponse response, String uuid);

    /**
     * 更新VR配置下发状态
     * @param result
     * @param reportConfigStatusVo
     * @return
     */
    JSONObject reportConfigStatus(ApiPageModeResult result, ReportConfigStatusVo reportConfigStatusVo);

    /**
     * 上报VR配置和状态信息
     * @param result
     * @param vrConfigAndStatusBean
     * @return
     */
    JSONObject configAndStatus(ApiPageModeResult result, VrConfigAndStatusBean vrConfigAndStatusBean);

    /**
     * 获取VR配置和状态信息
     * @param result
     * @param uuid
     * @return
     */
    JSONObject getConfigAndStatus(ApiPageModeResult result, String uuid);
}
