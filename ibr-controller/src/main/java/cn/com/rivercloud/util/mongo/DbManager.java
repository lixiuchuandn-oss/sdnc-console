package cn.com.rivercloud.util.mongo;

import com.mongodb.*;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;

/**
 * @author moyang
 **/
@Slf4j
public class DbManager {
    private static volatile DbManager instance;

    private MongoClient mongoClient;

    private DbManager() {

    }

    public static DbManager getInstance() {

        if (null == instance) {
            synchronized (DbManager.class) {
                if (null == instance) {
                    instance = new DbManager();
                    instance.init();
                }

            }
        }

        return instance;
    }

    private void init() {

        // 连接池选项
        Properties properties = PropertiesConfig.getInstacne().getProperties();

        // 选项构建者
        MongoClientOptions.Builder builder = new MongoClientOptions.Builder();

        // 每个地址最大请求数
        builder.connectionsPerHost(8);
        builder.threadsAllowedToBlockForConnectionMultiplier(4);

        // 设置连接超时时间
        builder.connectTimeout(10000);

        // 设置最大等待时间
        builder.maxWaitTime(120000);

        // 读取数据的超时时间
        builder.socketTimeout(1500);

        String hosts = properties.getProperty("mongodb.host");
        int port = Integer.parseInt(properties.getProperty("mongodb.port"));
        String userName = properties.getProperty("mongodb.userName");
        String password = properties.getProperty("mongodb.password");
        String dbName = properties.getProperty("mongodb.dbName");

        String[] hostIps = hosts.split(",");
        if (hostIps.length == 1) {//单机部署
            log.info("数据库配置为单机部署");
            ServerAddress serverAddress = new ServerAddress(hosts, port);
            List<MongoCredential> credentials = new ArrayList();
            MongoCredential credential = MongoCredential.createCredential(userName, dbName, password.toCharArray());  // 需要验证
            credentials.add(credential);
            mongoClient = new MongoClient(serverAddress, Arrays.asList(credential));
        } else {//集群部署
            //mongodb://db1.example.com:27017,db2.example.com:27017,db3.example.com:27017/myDatabase?replicaSet=myReplicaSet
            //mongodb://myUser:myPassword@db1.example.com:27017,db2.example.com:27017,db3.example.com:27017/myDatabase?replicaSet=myReplicaSet
            //String uriString = "mongodb://root:cloudmap#123@10.20.0.57:27017,10.20.0.63:27017/admin?replicaSet=myReplicaSet";
//            log.info("数据库配置为副本集部署");
//            String replicaSet = properties.getProperty("mongodb.replicaSet");
//            StringBuilder stringBuilder = new StringBuilder();
//            String hostsUri = getHostsUri(hostIps, port);
//            stringBuilder.append("mongodb://").append(userName).append(":").append(password).append("@").append(hostsUri)
//                    .append("/").append(dbName).append("?").append("replicaSet=").append(replicaSet);
//            MongoClientURI uri = new MongoClientURI(stringBuilder.toString());
//            mongoClient = new MongoClient(uri);
        }
    }

    private static String getHostsUri(String[] hostIps, int port) {
        StringBuilder stringBuilder = new StringBuilder();

        for (int i = 0; i < hostIps.length; i++) {
            stringBuilder.append(hostIps[i]).append(":").append(port).append(",");
        }

        //去掉最后一个,
        stringBuilder.deleteCharAt(stringBuilder.length() - 1);
        return stringBuilder.toString();
    }

    public MongoClient getMongoClient() {
        return mongoClient;
    }

    public DB getDataDb() {
        DB db = mongoClient.getDB("data");

        return db;
    }
}
