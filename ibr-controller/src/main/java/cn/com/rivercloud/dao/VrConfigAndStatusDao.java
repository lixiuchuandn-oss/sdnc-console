package cn.com.rivercloud.dao;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import cn.com.rivercloud.util.common.PubMethod;
import cn.com.rivercloud.util.mongo.JongoSingleton;
import cn.com.rivercloud.util.mongo.MaintainerDBName;
import com.google.common.collect.Lists;
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
public class VrConfigAndStatusDao {

    public static MongoCollection VR_CONTROLLER_SRV6 = JongoSingleton.getInstance(MaintainerDBName.VR_CONTROLLER_SRV6);

    public void insertSrv6(VrConfigAndStatusBean bean) {
        if (!PubMethod.isEmpty(bean)) {
            bean.setCreateDate(new Date());
            bean.setUpdateDate(new Date());
            VR_CONTROLLER_SRV6.insert(bean);
        }
    }

    public VrConfigAndStatusBean findByUuId(String uuid) {
        return VR_CONTROLLER_SRV6.findOne("{uuid:#}", uuid).as(VrConfigAndStatusBean.class);
    }

    public List<VrConfigAndStatusBean> findAll() {
        Iterator<VrConfigAndStatusBean> iterator = VR_CONTROLLER_SRV6.find(QueryBuilder.start().get().toString())
                .as(VrConfigAndStatusBean.class);
        return Lists.newArrayList(iterator);
    }

    public void updateVrSrv6(VrConfigAndStatusBean bean) {
        if (!PubMethod.isEmpty(bean.getId())) {
            bean.setUpdateDate(new Date());
            VR_CONTROLLER_SRV6.update(new ObjectId(bean.getId())).with(bean);
        }
    }

    public void deleteByUuid(String uuid) {
        VR_CONTROLLER_SRV6.remove("{uuid:#}", uuid);
    }
}
