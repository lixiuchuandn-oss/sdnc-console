package cn.com.rivercloud.service.impl;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import cn.com.rivercloud.bean.VrDeviceBean;
import cn.com.rivercloud.bean.vo.ReportConfigStatusVo;
import cn.com.rivercloud.dao.VrConfigDao;
import cn.com.rivercloud.dao.VrConfigAndStatusDao;
import cn.com.rivercloud.dao.VrDao;
import cn.com.rivercloud.enums.ReportConfigStatusEnum;
import cn.com.rivercloud.service.VrInService;
import cn.com.rivercloud.util.common.PubMethod;
import cn.com.rivercloud.util.exception.ServiceException;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import cn.com.rivercloud.util.result.ApiResultCode;
import cn.com.rivercloud.util.tar.TarGzCompressor;
import cn.hutool.core.io.FileUtil;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.List;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description
 */
@Slf4j
@Service
public class VrInServiceImpl implements VrInService {

    @Resource
    private VrDao vrDao;

    @Resource
    private VrConfigAndStatusDao vrConfigAndStatusDao;

    @Resource
    private VrConfigDao vrConfigDao;

    @Value("${vr.control.path:/usr/local/src/csm-controller/download/}")
    private String downloadPath;

    @Override
    public JSONObject register(ApiPageModeResult result, VrDeviceBean vrDeviceBean) {
        VrDeviceBean dbVrDeviceBean = vrDao.findByUuid(vrDeviceBean.getUuid());
        String msg;
        if (PubMethod.isEmpty(dbVrDeviceBean)) {
            vrDao.register(vrDeviceBean);
            msg = "VR虚机注册成功";
        } else {
            vrDeviceBean.setId(dbVrDeviceBean.getId());
            vrDao.updateVrDevice(vrDeviceBean);
            msg = "设备已注册, 仅更新该设备";
        }
        return result.data(new JSONObject().put("uuid", vrDeviceBean.getUuid())).msg(msg).build();
    }

    @Override
    public JSONObject unregister(ApiPageModeResult result, String uuid) {
        if (StringUtils.isEmpty(uuid)) {
            throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), "uuid不能为空");
        }
        vrDao.deleteByUuid(uuid);
        vrConfigDao.delete(uuid);
        vrConfigAndStatusDao.deleteByUuid(uuid);
        return result.data(new JSONObject()).msg("VR虚机注销成功").build();
    }

    @Override
    public JSONObject checkSum(ApiPageModeResult result, String uuid) {
        Document document = vrConfigDao.get(uuid);
        JSONObject jsonObject = new JSONObject();
        if (!PubMethod.isEmpty(document)) {
            jsonObject.put("checkSum", md5(document.toJson()));
        } else {
            log.warn("checkSum==> srv6配置为空");
        }
        // 和底层约定，如果没有配置，就返回空data
        return result.data(jsonObject).build();
    }

    @Override
    public void download(HttpServletResponse response, String uuid) {
        // 先查询是否存在此虚机对应的srv6配置
        Document document = vrConfigDao.get(uuid);
        if (document == null) {
            throw new ServiceException(
                    String.valueOf(ApiResultCode.NULL_SRV6_CONFIG.code()), ApiResultCode.NULL_SRV6_CONFIG.message());
        }
        document.remove("_id");
        document.remove("uuid");
        document.remove("createDate");
        document.remove("updateDate");
        // 生成虚拟机的配置文件
        createTar(document, uuid);
        // 下载tar包
        downloadTar(response, uuid);
    }

    @Override
    public JSONObject reportConfigStatus(ApiPageModeResult result, ReportConfigStatusVo reportConfigStatusVo) {
        Document document = vrConfigDao.get(reportConfigStatusVo.getUuid());
        String msg;
        if (document == null) {
            throw new ServiceException(
                    String.valueOf(ApiResultCode.NULL_SRV6_CONFIG.code()), ApiResultCode.NULL_SRV6_CONFIG.message());
        }
        msg = reportConfigStatusVo.getStatus() == ReportConfigStatusEnum.applied
                ? ReportConfigStatusEnum.applied.getDesc() : ReportConfigStatusEnum.error.getDesc();
        vrConfigDao.updateStatus(reportConfigStatusVo.getUuid(),
                reportConfigStatusVo.getStatus().getVal());
        return result.data(new JSONObject()).msg(msg).build();
    }

    @Override
    public JSONObject configAndStatus(ApiPageModeResult result, VrConfigAndStatusBean vrConfigAndStatusBean) {
        VrConfigAndStatusBean exists = vrConfigAndStatusDao.findByUuId(vrConfigAndStatusBean.getUuid());
        String msg;
        if (exists == null) {
            vrConfigAndStatusDao.insertSrv6(vrConfigAndStatusBean);
            msg = "上报VR配置和状态信息成功";
        } else {
            vrConfigAndStatusBean.setId(exists.getId());
            vrConfigAndStatusDao.updateVrSrv6(vrConfigAndStatusBean);
            msg = "更新VR配置和状态信息成功";
        }
        return result.data(new JSONObject()).msg(msg).build();
    }

    @Override
    public JSONObject getConfigAndStatus(ApiPageModeResult result, String uuid) {
        if (StringUtils.isEmpty(uuid)) {
            List<VrConfigAndStatusBean> all = vrConfigAndStatusDao.findAll();
            return result.data(all).msg("获取VR配置和状态信息成功").build();
        } else {
            VrConfigAndStatusBean vrConfigAndStatusBean = vrConfigAndStatusDao.findByUuId(uuid);
            return result.data(vrConfigAndStatusBean).msg("获取VR配置和状态信息成功").build();
        }
    }

    private void createTar(Document document, String filename) {
        if (!new File(downloadPath).exists()) {
            new File(downloadPath).mkdirs();
        }
        String[] jsonFiles = {filename + ".json"};
        FileUtil.writeLines(
                Collections.singletonList(document.toJson()),
                new File(downloadPath + filename + ".json"),
                Charset.defaultCharset());
        // 打成tar.gz包
        TarGzCompressor.addFileToTar(jsonFiles, filename);
    }

    /**
     * 下载tar包
     * @param response
     * @param filename
     */
    private void downloadTar(HttpServletResponse response, String filename) {
        try {
            // 确定文件路径
            File file = new File(downloadPath + filename + ".json");
            // 检查文件是否存在
            if (!file.exists()) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                response.getWriter().write("File not found");
                return;
            }

            // 设置响应头
            response.setContentType("application/octet-stream");
            response.setHeader("Content-Disposition", "attachment; filename=\"" + file.getName() + "\"");
            response.setContentLengthLong(file.length());

            // 将文件内容写入响应输出流
            try (FileInputStream fileInputStream = new FileInputStream(file);
                 OutputStream outputStream = response.getOutputStream()) {
                byte[] buffer = new byte[1024];
                int bytesRead;
                while ((bytesRead = fileInputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, bytesRead);
                }
            }
        } catch (Exception e) {
            try {
                response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
                response.getWriter().write("Error occurred while processing the file");
            } catch (Exception ignored) {
            }
        }
    }

    private static String md5(String input) {
        StringBuilder hexString = new StringBuilder();
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] messageDigest = md.digest(input.getBytes());
            for (byte b : messageDigest) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
        } catch (NoSuchAlgorithmException e) {
            throw new ServiceException(e);
        }
        return hexString.toString();
    }
}
