package cn.com.rivercloud.util.ip;

import java.text.Normalizer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * @author : chenhao
 */
public class IpValidateUtil {

    private static final String CIDR_PAT_STR = "^(?!^255(\\.255){3})(?!^0)(?!^127(\\.0){2}(\\.1))(([01]?\\d?\\d|2[0-4]\\d|25[0-5])\\.){3}([01]?\\d?\\d|2[0-4]\\d|25[0-5])\\/(\\d{1}|[0-2]{1}\\d{1}|3[0-2])$";

    private static final String IP_PAT_STR = "^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$";


    private static final Pattern ipPat = Pattern.compile(IP_PAT_STR);

    private static final Pattern cidrPat = Pattern.compile(CIDR_PAT_STR);

    private static final Pattern a = Pattern.compile("^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$");
    private static final Pattern b = Pattern.compile("^((([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){6}:[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){5}:([0-9A-Fa-f]{1,4}:)?[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){4}:([0-9A-Fa-f]{1,4}:){0,2}[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){3}:([0-9A-Fa-f]{1,4}:){0,3}[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){2}:([0-9A-Fa-f]{1,4}:){0,4}[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){6}((\\b((25[0-5])|(1\\d{2})|(2[0-4]\\d)|(\\d{1,2}))\\b)\\.){3}(\\b((25[0-5])|(1\\d{2})|(2[0-4]\\d)|(\\d{1,2}))\\b))|(([0-9A-Fa-f]{1,4}:){0,5}:((\\b((25[0-5])|(1\\d{2})|(2[0-4]\\d)|(\\d{1,2}))\\b)\\.){3}(\\b((25[0-5])|(1\\d{2})|(2[0-4]\\d)|(\\d{1,2}))\\b))|(::([0-9A-Fa-f]{1,4}:){0,5}((\\b((25[0-5])|(1\\d{2})|(2[0-4]\\d)|(\\d{1,2}))\\b)\\.){3}(\\b((25[0-5])|(1\\d{2})|(2[0-4]\\d)|(\\d{1,2}))\\b))|([0-9A-Fa-f]{1,4}::([0-9A-Fa-f]{1,4}:){0,5}[0-9A-Fa-f]{1,4})|(::([0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){1,7}:))$");
    private static final Pattern c = Pattern.compile("^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\\/([1-9]|[1-2]\\d|3[0-2])$");

    public static boolean isValidIpv4(String var0) {
        return a.matcher(var0).matches() || c.matcher(var0).matches();
    }

    public static boolean isValidIpv6(String var0) {
        String ip = var0;
        if (ip.startsWith("[")) {
            int i = ip.lastIndexOf(":");
            ip = ip.substring(1, i - 1);
        }
        String regex = "(^((([0-9A-Fa-f]{1,4}:){7}(([0-9A-Fa-f]{1,4}){1}|:))"
                + "|(([0-9A-Fa-f]{1,4}:){6}((:[0-9A-Fa-f]{1,4}){1}|"
                + "((22[0-3]|2[0-1][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})([.](25[0-5]|2[0-4][0-9]|"
                + "[0-1][0-9][0-9]|([0-9]){1,2})){3})|:))|"
                + "(([0-9A-Fa-f]{1,4}:){5}((:[0-9A-Fa-f]{1,4}){1,2}|"
                + ":((22[0-3]|2[0-1][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})([.](25[0-5]|2[0-4][0-9]|"
                + "[0-1][0-9][0-9]|([0-9]){1,2})){3})|:))|"
                + "(([0-9A-Fa-f]{1,4}:){4}((:[0-9A-Fa-f]{1,4}){1,3}"
                + "|:((22[0-3]|2[0-1][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})([.](25[0-5]|2[0-4][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})){3})|:))|(([0-9A-Fa-f]{1,4}:){3}((:[0-9A-Fa-f]{1,4}){1,4}|"
                + ":((22[0-3]|2[0-1][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})([.](25[0-5]|2[0-4][0-9]|"
                + "[0-1][0-9][0-9]|([0-9]){1,2})){3})|:))|"
                + "(([0-9A-Fa-f]{1,4}:){2}((:[0-9A-Fa-f]{1,4}){1,5}|"
                + ":((22[0-3]|2[0-1][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})([.](25[0-5]|2[0-4][0-9]|"
                + "[0-1][0-9][0-9]|([0-9]){1,2})){3})|:))"
                + "|(([0-9A-Fa-f]{1,4}:){1}((:[0-9A-Fa-f]{1,4}){1,6}"
                + "|:((22[0-3]|2[0-1][0-9]|[0-1][0-9][0-9]|"
                + "([0-9]){1,2})([.](25[0-5]|2[0-4][0-9]|"
                + "[0-1][0-9][0-9]|([0-9]){1,2})){3})|:))|"
                + "(:((:[0-9A-Fa-f]{1,4}){1,7}|(:[fF]{4}){0,1}:((22[0-3]|2[0-1][0-9]|"
                + "[0-1][0-9][0-9]|([0-9]){1,2})"
                + "([.](25[0-5]|2[0-4][0-9]|[0-1][0-9][0-9]|([0-9]){1,2})){3})|:)))$)";

        ip = Normalizer.normalize(ip, Normalizer.Form.NFKC);
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(ip);

        return matcher.matches();
    }

    public static boolean isCidr(String ip) {
        Matcher matcher = cidrPat.matcher(ip);
        return matcher.matches();
    }

    public static boolean isIp(String ip) {
        Matcher matcher = ipPat.matcher(ip);
        return matcher.matches();
    }

    public static boolean isIpSegment(String ip) {

        String[] ips = ip.split("-");
        if (ips != null && ips.length != 2) {
            return false;
        }

        String startIpStr = ips[0];
        String endIpStr = ips[1];
        Matcher startMatcher = ipPat.matcher(startIpStr);
        if (!startMatcher.matches()) {
            return false;
        }
        Matcher endMatcher = ipPat.matcher(endIpStr);
        if (!endMatcher.matches()) {
            return false;
        }

        long startIp = ipStr2Long(startIpStr);
        long endIp = ipStr2Long(endIpStr);

        if (startIp > endIp) {
            return false;
        }
        return true;
    }

    public static long ipStr2Long(String ip) {
        ip = ip.trim();
        String[] ips = ip.split("\\.");
        long ip2long = 0L;
        for (int i = 0; i < 4; ++i) {
            ip2long = ip2long << 8 | Integer.parseInt(ips[i]);
        }
        return ip2long;
    }


}
