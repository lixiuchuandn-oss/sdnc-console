package cn.com.rivercloud.dao;

import cn.com.rivercloud.bean.VrDeviceBean;
import cn.com.rivercloud.util.common.PubMethod;
import cn.com.rivercloud.util.mongo.JongoSingleton;
import cn.com.rivercloud.util.mongo.MaintainerDBName;
import cn.com.rivercloud.util.result.Pagination;
import com.google.common.collect.Lists;
import com.mongodb.DBObject;
import com.mongodb.QueryBuilder;
import org.bson.types.ObjectId;
import org.jongo.MongoCollection;
import org.springframework.stereotype.Component;

import java.util.Date;
import java.util.Iterator;
import java.util.List;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description
 */
@Component
public class VrDao {

    public static MongoCollection VR_CONTROLLER_DEVICE = JongoSingleton.getInstance(MaintainerDBName.VR_CONTROLLER_DEVICE);

    public void register(VrDeviceBean bean) {
        if (!PubMethod.isEmpty(bean)) {
            bean.setCreateDate(new Date());
            bean.setUpdateDate(new Date());
            VR_CONTROLLER_DEVICE.insert(bean);
        }
    }
    public VrDeviceBean findByUuid(String uuid) {
        return VR_CONTROLLER_DEVICE.findOne("{uuid:#}", uuid).as(VrDeviceBean.class);
    }

    public void updateVrDevice(VrDeviceBean bean) {
        if (!PubMethod.isEmpty(bean.getId())) {
            bean.setUpdateDate(new Date());
            VR_CONTROLLER_DEVICE.update(new ObjectId(bean.getId())).with(bean);
        }
    }

    public void deleteByUuid(String uuid) {
        VR_CONTROLLER_DEVICE.remove("{uuid:#}", uuid);
    }

    public List<VrDeviceBean> search(Pagination pagination, QueryBuilder queryBuilder) {
        DBObject dbObject = queryBuilder.get();
        Iterator<VrDeviceBean> iterator = VR_CONTROLLER_DEVICE.find(dbObject.toString())
                .skip(pagination.getSkip())
                .limit(pagination.getPageSize())
                .as(VrDeviceBean.class);
        long total = VR_CONTROLLER_DEVICE.count(dbObject.toString());
        pagination.setTotal(total);
        return Lists.newArrayList(iterator);
    }

    public long searchCount(QueryBuilder queryBuilder) {
        DBObject dbObject = queryBuilder.get();
        return VR_CONTROLLER_DEVICE.count(dbObject.toString());
    }

    public void updateVrDeviceHealth(VrDeviceBean bean) {
        if (!PubMethod.isEmpty(bean.getId())) {
            bean.setUpdateDate(new Date());
//            VR_CONTROLLER_DEVICE.update("{_id:#}", new ObjectId(bean.getId())).with("{$set:{health_status:#}}", bean.getHealthStatus());
            VR_CONTROLLER_DEVICE.update("{_id:#}", new ObjectId(bean.getId()))
                    .with("{$set:{health_status:#, updateDate:#, resourceIndicators:#}}",
                            bean.getHealthStatus(),
                            bean.getUpdateDate(),
                            bean.getResourceIndicators());
        }
    }

    public List<VrDeviceBean> find(QueryBuilder queryBuilder) {
        DBObject dbObject = queryBuilder.get();
        Iterator<VrDeviceBean> iterator = VR_CONTROLLER_DEVICE.find(dbObject.toString()).as(VrDeviceBean.class);
        return Lists.newArrayList(iterator);
    }
}
