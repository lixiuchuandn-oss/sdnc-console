package cn.com.rivercloud.util.ip;

/** 系统类型
 * @author syr
 */
public class CSMCKernel {

    public static OS platform;

    static {
        platform = System.getProperty("os.name").toLowerCase().indexOf("windows") >= 0 ? OS.windows : OS.linux;
    }

    public CSMCKernel() {
    }

    public static enum OS {
        windows,
        linux;
        private OS() {
        }
    }
}
