package cn.com.rivercloud.util.mongo;

import org.jongo.Jongo;
import org.jongo.MongoCollection;

/**
 * @author songpenghui
 * @create 2019/12/18 3:20 PM
 * @description jongo单例
 */
public class JongoSingleton {


    private JongoSingleton() {

    }

    private static class SingletonInstance {
        private static final Jongo INSTANCE  = new Jongo(DbManager.getInstance().getDataDb());

    }

    public static MongoCollection getInstance(String dbName) {
        Jongo instance = SingletonInstance.INSTANCE;
        MongoCollection col = instance.getCollection(dbName);
        return col;

    }

}
