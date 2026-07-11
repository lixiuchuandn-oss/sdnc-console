package cn.com.rivercloud.util.tar;

import lombok.extern.slf4j.Slf4j;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * @author LiYutao
 * @date 2024/12/9
 * @description
 */
@Slf4j
public class TarGzExtractor {

    /**
     * 解压tar包
     * @param tarGzFile 压缩文件路径
     * @param destDir 解压目标目录
     */
    public static void tarGzExtractor(String tarGzFile, String destDir) {
        // 创建目标目录
        File outputDir = new File(destDir);
        if (!outputDir.exists()) {
            outputDir.mkdirs();
        }

        try {
            // 创建输入流，解压 tar.gz 文件
            FileInputStream fis = new FileInputStream(tarGzFile);
            GzipCompressorInputStream gzIn = new GzipCompressorInputStream(fis);
            TarArchiveInputStream tarIn = new TarArchiveInputStream(gzIn);

            // 解压 tar.gz 中的每个文件
            TarArchiveEntry entry;
            while ((entry = tarIn.getNextTarEntry()) != null) {
                // 获取当前条目的文件路径
                File outputFile = new File(destDir, entry.getName());

                // 如果是目录，则创建目录
                if (entry.isDirectory()) {
                    outputFile.mkdirs();
                } else {
                    // 如果是文件，则解压到目标路径
                    try (FileOutputStream fos = new FileOutputStream(outputFile)) {
                        byte[] buffer = new byte[1024];
                        int length;
                        while ((length = tarIn.read(buffer)) != -1) {
                            fos.write(buffer, 0, length);
                        }
                    }
                }
            }

            // 关闭流
            tarIn.close();
            gzIn.close();
            fis.close();

            log.warn(" {} tarGzFile 压缩文件解压完成!", tarGzFile);

        } catch (Exception e) {
            log.error(" {} tarGzFile 压缩文件解压失败!", tarGzFile, e);
        }
    }
}
