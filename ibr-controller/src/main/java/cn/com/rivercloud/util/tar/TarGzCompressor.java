package cn.com.rivercloud.util.tar;

import lombok.extern.slf4j.Slf4j;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

@Slf4j
public class TarGzCompressor {

    /**
     * 打成tar包
     * @param jsonFiles JSON 文件路径列表
     * @param filename 文件名
     */
    public static void addFileToTar(String[] jsonFiles, String filename) {
        // 目标压缩文件路径
        String outputTarGz = filename + ".tar.gz";

        try {
            // 创建输出流，压缩文件（.tar.gz）
            FileOutputStream tarGzFile = new FileOutputStream(outputTarGz);
            GzipCompressorOutputStream gzOut = new GzipCompressorOutputStream(tarGzFile);
            TarArchiveOutputStream tarOut = new TarArchiveOutputStream(gzOut);

            // 设置为标准 tar 格式
            tarOut.setLongFileMode(TarArchiveOutputStream.LONGFILE_GNU);

            // 遍历所有 JSON 文件并将它们添加到 TAR
            for (String jsonFile : jsonFiles) {
                addFileToTar(tarOut, jsonFile);
            }

            // 关闭流
            tarOut.close();
            gzOut.close();
            tarGzFile.close();

            log.info("{} json文件 {} vr配置文件tar.gz包创建成功!", jsonFiles, filename);

        } catch (Exception e) {
            log.error("{} json文件 {} vr配置文件tar.gz包创建失败!", jsonFiles, filename, e);
        }
    }

    private static void addFileToTar(TarArchiveOutputStream tarOut, String filePath) throws IOException {
        File file = new File(filePath);
        if (!file.exists()) {
            return;
        }

        // 创建 TAR 文件的条目
        TarArchiveEntry tarEntry = new TarArchiveEntry(file, file.getName());
        tarOut.putArchiveEntry(tarEntry);

        // 写入文件内容
        try (FileInputStream fileInputStream = new FileInputStream(file)) {
            byte[] buffer = new byte[1024];
            int length;
            while ((length = fileInputStream.read(buffer)) != -1) {
                tarOut.write(buffer, 0, length);
            }
        }

        // 完成此条目的写入
        tarOut.closeArchiveEntry();
    }
}
