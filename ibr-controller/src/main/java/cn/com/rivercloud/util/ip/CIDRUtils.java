package cn.com.rivercloud.util.ip;

import java.math.BigInteger;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class CIDRUtils {

    // Range类表示一个CIDR转换后的开始和结束IP地址
    public static class Range {
        BigInteger start;
        BigInteger end;

        Range(BigInteger start, BigInteger end) {
            this.start = start;
            this.end = end;
        }
    }

    // 将CIDR转换为IP范围（开始IP和结束IP）
    public static Range getRange(String cidr) throws UnknownHostException {
        String[] parts = cidr.split("/");
        String ip = parts[0];
        int prefix = Integer.parseInt(parts[1]);

        InetAddress inetAddress = InetAddress.getByName(ip);
        byte[] bytes = inetAddress.getAddress();
        BigInteger ipValue = new BigInteger(1, bytes);

        // 计算CIDR范围
        int totalBits = bytes.length * 8;
        BigInteger start = ipValue.and(BigInteger.valueOf(-1).shiftLeft(totalBits - prefix));
        BigInteger end = start.add(BigInteger.ONE.shiftLeft(totalBits - prefix).subtract(BigInteger.ONE));
        return new Range(start, end);
    }

    // 检查多个CIDR是否有IP地址重叠
    public static boolean hasOverlap(List<String> ciDrs) throws UnknownHostException {
        List<Range> ranges = new ArrayList<>();
        // 将CIDR转换为IP地址范围
        for (String cidr : ciDrs) {
            ranges.add(getRange(cidr));
        }
        // 按起始地址排序
        ranges.sort(Comparator.comparing(range -> range.start));
        // 线性扫描检查是否有重叠
        for (int i = 1; i < ranges.size(); i++) {
            if (ranges.get(i).start.compareTo(ranges.get(i - 1).end) <= 0) {
                return true; // 如果有重叠，返回true
            }
        }
        return false; // 没有重叠
    }

    public static void main(String[] args) {
        try {
            // 示例：多个CIDR
            List<String> ciDrs = new ArrayList<>();
            ciDrs.add("10::1/64");
            ciDrs.add("10::2/64");
            ciDrs.add("100::64/64");
            ciDrs.add("400::64/69");
            if (hasOverlap(ciDrs)) {
                System.out.println("There are overlapping CIDRs.");
            } else {
                System.out.println("There are no overlapping CIDRs.");
            }
        } catch (UnknownHostException ignored) {}
    }
}
