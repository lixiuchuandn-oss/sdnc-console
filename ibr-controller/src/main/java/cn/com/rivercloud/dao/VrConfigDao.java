package cn.com.rivercloud.dao;

import cn.com.rivercloud.util.mongo.JongoSingleton;
import cn.com.rivercloud.util.mongo.MaintainerDBName;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.jongo.MongoCollection;
import org.springframework.stereotype.Component;

import java.util.Date;

@Component
public class VrConfigDao {

    public static MongoCollection VR_CONTROLLER_SRV6_CONFIG =
            JongoSingleton.getInstance(MaintainerDBName.VR_CONTROLLER_SRV6_CONFIG);

    /**
     * 新增或更新
     * @param json
     */
    public boolean add(String json) {
        Document parse = Document.parse(json);
        boolean configExists;
        Document exists =
                VR_CONTROLLER_SRV6_CONFIG.findOne("{uuid:#}", parse.getString("uuid")).as(Document.class);
        parse.append("updateDate", new Date());
        if (exists == null) {
            configExists = false;
            parse.append("createDate", new Date());
            VR_CONTROLLER_SRV6_CONFIG.insert(parse);
        } else {
            configExists = true;
            // 先删除再插入
            delete(parse.getString("uuid"));
            parse.append("createDate", new Date());
            VR_CONTROLLER_SRV6_CONFIG.insert(parse);
        }
        return configExists;
    }

    /**
     * 查询VR配置
     * @param uuid
     * @return
     */
    public Document get(String uuid) {
        return VR_CONTROLLER_SRV6_CONFIG.findOne("{uuid:#}", uuid).as(Document.class);
    }

    /**
     * 更新VR配置生效状态
     * @param uuid
     * @param status
     */
    public void updateStatus(String uuid, String status) {
        VR_CONTROLLER_SRV6_CONFIG.update("{uuid:#}", uuid).with("{$set:{report_config_status:#}}", status);
    }

    /**
     * 删除VR配置
     * @param uuid
     */
    public void delete(String uuid) {
        VR_CONTROLLER_SRV6_CONFIG.remove("{uuid: #}", uuid);
    }
}
