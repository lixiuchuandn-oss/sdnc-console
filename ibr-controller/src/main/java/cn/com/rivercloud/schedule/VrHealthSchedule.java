package cn.com.rivercloud.schedule;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import cn.com.rivercloud.bean.VrDeviceBean;
import cn.com.rivercloud.dao.VrConfigAndStatusDao;
import cn.com.rivercloud.dao.VrDao;
import cn.com.rivercloud.enums.DeviceHealthEnum;
import cn.com.rivercloud.util.common.PubMethod;
import com.mongodb.QueryBuilder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.List;

/**
 * @author LiYutao
 * @date 2024/11/14
 * @description
 */
@Slf4j
@Component
public class VrHealthSchedule {

    @Resource
    private VrDao vrDao;
    @Resource
    private VrConfigAndStatusDao vrConfigAndStatusDao;

    @Value("${vr.health.interval:120000}")
    public long healthInterval;

    @Scheduled(cron = "*/10 * * * * ?")
    public void scheduleTask () {
        // 通过上报srv6信息的更新时间是否在可配时间内来检测vr虚机的健康状态
        List<VrDeviceBean> vrDeviceBeans = vrDao.find(QueryBuilder.start());
        if (PubMethod.isEmpty(vrDeviceBeans)) {
            return;
        }
        for (VrDeviceBean vrDevice : vrDeviceBeans) {
            VrConfigAndStatusBean vrConfigAndStatusBean = vrConfigAndStatusDao.findByUuId(vrDevice.getUuid());
            // 通过上报srv6信息的更新时间是否在可配时间内来检测vr虚机的健康状态
            if (PubMethod.isEmpty(vrConfigAndStatusBean)) {
                log.warn("未发现{}虚机上报的srv6隧道信息!", vrDevice.getUuid());
                continue;
            }
            boolean valid = System.currentTimeMillis() - vrConfigAndStatusBean.getUpdateDate().getTime() <= healthInterval;
            String healthState = valid ? DeviceHealthEnum.ONLINE.toString() : DeviceHealthEnum.OFFLINE.toString();
            vrDevice.setResourceIndicators(vrConfigAndStatusBean.getResourceIndicators());
            vrDevice.setHealthStatus(healthState);
            vrDao.updateVrDeviceHealth(vrDevice);
            log.warn("{} vr虚机健康状态更新为 {}!", vrDevice.getUuid(), healthState);
        }
    }
}
