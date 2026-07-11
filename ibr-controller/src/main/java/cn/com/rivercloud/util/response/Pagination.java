package cn.com.rivercloud.util.response;

import lombok.Data;

/**
 * @author songpenghui
 * @create 2020/1/7 2:06 PM
 * @description 分页信息
 */
@Data
public class Pagination {


    private int current=1;

    private int pageSize=10;

    private long total=0;

    public Pagination(int current, int pageSize, long total) {
        this.current = current;
        this.pageSize = pageSize;
        this.total = total;
    }

    public Pagination(int page_size, int page_num){
        this.pageSize = Math.max(page_size, 1);
        this.current = Math.max(page_num, 1);
    }

}
