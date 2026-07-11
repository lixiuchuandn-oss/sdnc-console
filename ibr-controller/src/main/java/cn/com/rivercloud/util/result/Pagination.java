package cn.com.rivercloud.util.result;

/**
 * 分页信息
 */
public class Pagination {

    private int current = 1;

    private int pageSize = 10;

    private long total = 0;

    private long errorTotal = 0;

    private long unread = 0;

    public int getOffset() {
        return pageSize * (current - 1);
    }

    public int getCurrent() {
        return current;
    }

    public void setCurrent(int current) {
        this.current = current > 0 ? current : 1;
    }

    public int getPageSize() {
        return pageSize;
    }

    public void setPageSize(int pageSize) {
        this.pageSize = pageSize > 0 ? pageSize : 10;
    }

    public long getTotal() {
        return total;
    }

    public void setTotal(long total) {
        this.total = total;
    }

    public long getUnread() {
        return unread;
    }

    public void setUnread(long unread) {
        this.unread = unread;
    }

    public void setErrorTotal(long errorTotal) {
        this.errorTotal = errorTotal;
    }

    public long getErrorTotal() {
        return errorTotal;
    }

    public Pagination() {
    }

    public Pagination(int current, int pageSize, long total) {
        this.current = current;
        this.pageSize = pageSize;
        this.total = total;
    }

    public Pagination(int current, int pageSize, long total, long errorTotal) {
        this.current = current;
        this.pageSize = pageSize;
        this.total = total;
        this.errorTotal = errorTotal;
    }

    public int getSkip() {
        return pageSize * (current - 1);
    }
}
