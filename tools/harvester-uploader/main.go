package main

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"flag"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// --- 配置结构 ---
type Config struct {
	TowerURL       string
	TowerToken     string
	HarvesterHost  string
	HarvesterToken string
}

type Cloud struct {
	Id       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Config   struct {
		Endpoint string `json:"endpoint"`
	} `json:"config"`
}

type CloudResponse struct {
	Items []Cloud `json:"items"`
}

type CreateImageRequest struct {
	Namespace   string `json:"namespace"`
	DisplayName string `json:"displayName"`
	SourceType  string `json:"sourceType"`
}

type ImageResource struct {
	Metadata struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"metadata"`
}

var reader = bufio.NewReader(os.Stdin)
var client = &http.Client{
	Timeout: 0, // 上传大文件不设超时
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // 允许自签名证书
	},
}

func main() {
	gui := flag.Bool("gui", false, "启动本地图形界面")
	direct := flag.Bool("direct", false, "直连 Cloudmap（跳过 Tower）")
	testServer := flag.Bool("test-server", false, "启动本地测试服务器 (Debug)")
	
	// CLI Args for direct mode
	argUrl := flag.String("url", "", "Cloudmap URL")
	argToken := flag.String("token", "", "Cloudmap Token")
	argNs := flag.String("ns", "default", "Namespace")
	argName := flag.String("name", "", "Image Name")
	argFile := flag.String("file", "", "Local File Path")
	argImageType := flag.String("type", "", "Image Type: disk (qcow2) or iso")

	flag.Parse()

	if *testServer {
		runTestServer()
		return
	}

	// 默认启动 GUI 模式，除非指定了 direct
	if *gui || (!*direct && len(os.Args) == 1) {
		startGUI()
		return
	}
	if *direct {
		fmt.Println("==============================================")
		fmt.Println("   Cloudmap 直连模式 (跳过 Tower)")
		fmt.Println("==============================================")
		cfg := Config{}
		
		if *argUrl != "" {
			cfg.HarvesterHost = normalizeHost(*argUrl)
		} else {
			cfg.HarvesterHost = normalizeHost(prompt("Cloudmap 地址 (如 https://x.x.x.x): "))
		}

		if *argToken != "" {
			cfg.HarvesterToken = *argToken
		} else {
			cfg.HarvesterToken = prompt("Cloudmap Token: ")
		}

		var ns string
		// Only prompt for namespace if we are in interactive mode (inferred from missing URL)
		if *argUrl == "" {
			ns = prompt("命名空间 [默认 default]: ")
			if ns == "" {
				ns = "default"
			}
		} else {
			ns = *argNs
		}

		var display string
		if *argName != "" {
			display = *argName
		} else {
			display = prompt("镜像显示名称 (如 ubuntu-20.04): ")
		}

		var imageType string
		if *argImageType != "" {
			imageType = *argImageType
		} else {
			typeInput := prompt("镜像类型 [disk/iso，留空自动推断]: ")
			if typeInput != "" {
				imageType = strings.ToLower(typeInput)
			}
		}

		var fpath string
		if *argFile != "" {
			fpath = *argFile
		} else {
			fpath = prompt("本地文件路径: ")
		}
		
		fpath = strings.Trim(fpath, "\"'")
		if _, err := os.Stat(fpath); os.IsNotExist(err) {
			fmt.Println("文件不存在")
			return
		}
		fmt.Print("[1/2] 在 Cloudmap 创建镜像记录... ")
		name, uploadUrl, err := createHarvesterImage(cfg, ns, display, imageType)
		if err != nil {
			fmt.Printf("失败: %v\n", err)
			return
		}
		fmt.Printf("成功 (Name: %s)\n", name)

	// Add a small delay to allow the resource to initialize
	fmt.Println("等待资源初始化 (5秒)...")
	time.Sleep(5 * time.Second)

	fmt.Println("[2/2] 正在直传文件到 Cloudmap (请勿关闭窗口)...")
	if err := uploadToHarvester(cfg, ns, name, fpath, uploadUrl); err != nil {
		fmt.Printf("上传失败: %v\n", err)
		return
	}
	fmt.Println("✅ 上传成功")
		return
	}
	fmt.Println("==============================================")
	fmt.Println("   Cloudmap 镜像直传工具 (Cloudmap Uploader)")
	fmt.Println("==============================================")
	fmt.Println("说明: 本工具仅通过 Tower 创建元数据，文件流直接上传至 Cloudmap。")
	fmt.Println("----------------------------------------------")

	config := Config{}

	// 1. 输入 Tower 信息
	config.TowerURL = prompt("Tower 地址 (如 http://192.168.1.10:5001): ")
	config.TowerURL = strings.TrimRight(config.TowerURL, "/")
	config.TowerToken = prompt("Tower 用户 Token: ")

	// 2. 选择资源池
	fmt.Println("\n正在连接 Tower 获取资源池...")
	clouds, err := fetchHarvesterClouds(config)
	if err != nil {
		fmt.Printf("错误: %v\n", err)
		pause()
		return
	}
	if len(clouds) == 0 {
		fmt.Println("未找到 Cloudmap 类型的资源池。")
		pause()
		return
	}

	fmt.Println("可用资源池:")
	for i, c := range clouds {
		fmt.Printf("[%d] %s (Endpoint: %s)\n", i+1, c.Name, c.Config.Endpoint)
	}
	idxStr := prompt(fmt.Sprintf("请选择 [1-%d]: ", len(clouds)))
	idx, _ := strconv.Atoi(idxStr)
	if idx < 1 || idx > len(clouds) {
		fmt.Println("无效选择")
		return
	}
	selectedCloud := clouds[idx-1]
	config.HarvesterHost = normalizeHost(selectedCloud.Config.Endpoint)

	// 3. 填写镜像信息
	fmt.Println("\n--- 镜像信息 ---")
	namespace := prompt("命名空间 [默认 default]: ")
	if namespace == "" {
		namespace = "default"
	}
	displayName := prompt("显示名称 (如 ubuntu-20.04): ")
	imageType := prompt("镜像类型 [disk/iso，留空自动推断]: ")
	if imageType != "" {
		imageType = strings.ToLower(imageType)
	}
	filePath := prompt("本地文件路径 (如 C:\\images\\disk.qcow2): ")
	filePath = strings.Trim(filePath, "\"'") // 去除拖拽文件可能产生的引号

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		fmt.Println("文件不存在!")
		return
	}

	// 4. 输入 Cloudmap Token
	fmt.Println("\n--- Cloudmap 认证 ---")
	fmt.Println("请输入 Cloudmap 集群 API Token (非 Tower Token)")
	config.HarvesterToken = prompt("Bearer Token: ")

	// 5. 执行
	fmt.Println("\n开始执行...")
	
	// A. Tower 创建
	fmt.Print("[1/2] 在 Tower 创建记录... ")
	imgMeta, err := createTowerImage(config, selectedCloud.Id, namespace, displayName, imageType)
	if err != nil {
		fmt.Printf("失败: %v\n", err)
		return
	}
	fmt.Printf("成功 (Name: %s)\n", imgMeta.Metadata.Name)

	// B. Cloudmap 直传
	fmt.Println("[2/2] 正在直传文件到 Cloudmap (请勿关闭窗口)...")
	err = uploadToHarvester(config, imgMeta.Metadata.Namespace, imgMeta.Metadata.Name, filePath, "")
	if err != nil {
		fmt.Printf("上传失败: %v\n", err)
		return
	}

	fmt.Println("\n----------------------------------------------")
	fmt.Println("   ✅ 上传成功！")
	fmt.Println("----------------------------------------------")
	pause()
}

// --- 辅助函数 ---

func prompt(label string) string {
	fmt.Print(label)
	text, _ := reader.ReadString('\n')
	// Remove BOM and trim spaces
	text = strings.ReplaceAll(text, "\uFEFF", "")
	return strings.TrimSpace(text)
}

func pause() {
	fmt.Println("\n按回车退出...")
	reader.ReadString('\n')
}

func normalizeHost(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err == nil && u.Scheme != "" {
		return u.Scheme + "://" + u.Host
	}
	return endpoint
}

func fetchHarvesterClouds(cfg Config) ([]Cloud, error) {
	req, _ := http.NewRequest("GET", cfg.TowerURL+"/api/clouds", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.TowerToken)
	resp, err := client.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 { return nil, fmt.Errorf("HTTP %d", resp.StatusCode) }
	
	var res CloudResponse
	json.NewDecoder(resp.Body).Decode(&res)
	var list []Cloud
	for _, c := range res.Items {
		if c.Provider == "harvester" || strings.HasPrefix(strings.ToLower(c.Provider), "cloudmap") { list = append(list, c) }
	}
	return list, nil
}

func createTowerImage(cfg Config, cloudId, ns, name, imageType string) (*ImageResource, error) {
	// 根据imageType设置diskFormat
	var diskFormat string
	if imageType == "iso" {
		diskFormat = "iso"
	} else if imageType == "disk" {
		diskFormat = "qcow2"
	}
	
	payload := CreateImageRequest{Namespace: ns, DisplayName: name, SourceType: "upload"}
	bodyMap := map[string]interface{}{
		"namespace":   payload.Namespace,
		"displayName": payload.DisplayName,
		"sourceType":  payload.SourceType,
	}
	if diskFormat != "" {
		bodyMap["diskFormat"] = diskFormat
	}
	body, _ := json.Marshal(bodyMap)
	
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/clouds/%s/resources/harvester/images", cfg.TowerURL, cloudId), bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+cfg.TowerToken)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := client.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 201 {
		return nil, fmt.Errorf("%s", string(respBody))
	}
	
	// 尝试解析两种可能的返回结构 (直接对象或 {data: ...})
	var wrapper struct { Data ImageResource `json:"data"` }
	if json.Unmarshal(respBody, &wrapper) == nil && wrapper.Data.Metadata.Name != "" {
		return &wrapper.Data, nil
	}
	var direct ImageResource
	json.Unmarshal(respBody, &direct)
	return &direct, nil
}

func uploadToHarvester(cfg Config, ns, name, fpath, uploadUrl string) error {
	file, err := os.Open(fpath)
	if err != nil { return err }
	defer file.Close()
	
	stat, _ := file.Stat()
	size := stat.Size()
	start := time.Now()

	// Show progress in a separate goroutine or wrap the reader?
	// To keep it simple, we use a pass-through reader that prints progress
	// But since we are reusing uploadReaderToHarvester logic (which doesn't print progress to stdout in the same way),
	// we should implement the progress bar here by wrapping the reader.
	
	progressReader := &ProgressReader{
		Reader: file,
		Total:  size,
		Start:  start,
	}
	
	return uploadReaderToHarvester(cfg, ns, name, filepath.Base(fpath), fpath, uploadUrl, size, progressReader)
}

type ProgressReader struct {
	io.Reader
	Total   int64
	Written int64
	Start   time.Time
}

func (pr *ProgressReader) Read(p []byte) (int, error) {
	n, err := pr.Reader.Read(p)
	if n > 0 {
		pr.Written += int64(n)
		elapsed := time.Since(pr.Start).Seconds()
		speed := float64(pr.Written) / 1048576.0 / elapsed // MB/s
		remain := float64(pr.Total-pr.Written)
		var etaText string
		if speed > 0 {
			eta := remain / 1048576.0 / speed
			etaText = fmt.Sprintf(", 速度: %.2f MB/s, 剩余: %.0fs", speed, eta)
		}
		fmt.Printf("\r进度: %.1f%% (%.1f/%.1f MB%s)", float64(pr.Written)/float64(pr.Total)*100, float64(pr.Written)/1048576, float64(pr.Total)/1048576, etaText)
	}
	return n, err
}

func createHarvesterImage(cfg Config, ns, displayName, imageType string) (string, string, error) {
	// 生成合法 name（小写、去空格），加时间戳避免重复
	base := strings.ToLower(strings.ReplaceAll(displayName, " ", "-"))
	if base == "" {
		base = "image"
	}
	name := fmt.Sprintf("%s-%d", base, time.Now().UnixNano())
	
	// 根据imageType设置diskFormat
	spec := map[string]any{
		"displayName": displayName,
		"sourceType":  "upload",
	}
	if imageType == "iso" {
		spec["diskFormat"] = "iso"
	} else if imageType == "disk" {
		spec["diskFormat"] = "qcow2"
	}
	
	payload := map[string]any{
		"apiVersion": "harvesterhci.io/v1beta1",
		"kind":       "VirtualMachineImage",
		"metadata": map[string]any{
			"name":      name,
			"namespace": ns,
		},
		"spec": spec,
	}
	body, _ := json.Marshal(payload)
	// Try standard K8s API path
	// createUrl := fmt.Sprintf("%s/apis/harvesterhci.io/v1beta1/namespaces/%s/virtualmachineimages", cfg.HarvesterHost, ns)
	// If Host ends with /v3, assume Rancher Proxy, maybe we need to adjust?
	// But usually appending /apis/... works if /v3 is the base.
	// Actually, let's try the simplified path if the standard one fails? No, keep standard for now.
	
	// Check if we need to use the "Steve" API format which Harvester uses heavily: /v1/harvester/harvesterhci.io.virtualmachineimages
	// The user's previous success suggests one of them worked. The code previously used:
	// fmt.Sprintf("%s/v1/harvester/harvesterhci.io.virtualmachineimages", cfg.HarvesterHost)
	// Wait, my previous reading of the code (line 332 in original) showed:
	// req, _ := http.NewRequest("POST", fmt.Sprintf("%s/v1/harvester/harvesterhci.io.virtualmachineimages", cfg.HarvesterHost), bytes.NewBuffer(body))
	// So I should stick to that if it worked.
	
	req, err := http.NewRequest("POST", fmt.Sprintf("%s/v1/harvester/harvesterhci.io.virtualmachineimages", cfg.HarvesterHost), bytes.NewBuffer(body))
	if err != nil {
		return "", "", fmt.Errorf("create request failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfg.HarvesterToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", "", fmt.Errorf("Cloudmap Error %d: %s", resp.StatusCode, string(b))
	}
	var obj struct {
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
		Actions map[string]string `json:"actions"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		// 如果解析失败，仍返回生成的 name
		fmt.Printf("Warning: Failed to parse response actions: %v\n", err)
		return name, "", nil
	}
	fmt.Printf("DEBUG: Created Image Actions: %v\n", obj.Actions)
	if obj.Metadata.Name == "" {
		return name, "", nil
	}
	return obj.Metadata.Name, obj.Actions["upload"], nil
}

func checkImageStatus(cfg Config, ns, name string) (bool, error) {
	host := strings.TrimSuffix(cfg.HarvesterHost, "/v3")
	url := fmt.Sprintf("%s/v1/harvester/harvesterhci.io.virtualmachineimages/%s/%s", host, ns, name)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.HarvesterToken)

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 10 * time.Second,
	}

	for i := 0; i < 5; i++ {
		resp, err := client.Do(req)
		if err != nil {
			return false, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return false, fmt.Errorf("status check failed with %d", resp.StatusCode)
		}

		body, _ := io.ReadAll(resp.Body)
		var obj struct {
			Status struct {
				Progress int `json:"progress"`
				Conditions []struct {
					Type   string `json:"type"`
					Status string `json:"status"`
				} `json:"conditions"`
			} `json:"status"`
		}
		if err := json.Unmarshal(body, &obj); err != nil {
			return false, err
		}

		if obj.Status.Progress == 100 {
			return true, nil
		}
		
		// Check for Imported condition
		for _, cond := range obj.Status.Conditions {
			if cond.Type == "Imported" && cond.Status == "True" {
				return true, nil
			}
		}

		fmt.Printf("镜像状态检查: 进度 %d%%, 等待中...\n", obj.Status.Progress)
		time.Sleep(2 * time.Second)
	}
	return false, fmt.Errorf("image not ready after check")
}

func uploadReaderToHarvester(cfg Config, ns, name, filename, localFilePath, uploadUrl string, fileSize int64, reader io.Reader) error {
	// ---------------------------------------------------------
	// 4. Harvester/Longhorn 要求文件大小必须是 512 字节对齐
	//    如果不满足，需要在流末尾填充 0
	// ---------------------------------------------------------
	padding := int64(0)
	if remainder := fileSize % 512; remainder != 0 {
		padding = 512 - remainder
	}
	finalFileSize := fileSize + padding
	
	if padding > 0 {
		fmt.Printf("提示: 文件大小 (%d) 非 512 字节对齐，将自动填充 %d 字节...\n", fileSize, padding)
	}

	// ---------------------------------------------------------
	// 5. 构造 multipart 请求体 (Headers + Body)
	// ---------------------------------------------------------
	// 使用 io.MultiReader 手动拼接，避免 multipart.Writer 封装带来的不确定性和 Pipe 复杂性
	// 这样可以精确控制每一个字节，确保 Content-Length 100% 正确
	// ---------------------------------------------------------

	// 4. 获取上传 URL
 	// 如果没有直接提供 uploadUrl，我们需要从 Image 对象的 actions 字段获取
 	// 或者构造默认 URL
 	
 	// 先处理 URL 逻辑，以便 curl 可以使用
 	host := strings.TrimSuffix(cfg.HarvesterHost, "/v3")
 	url := uploadUrl
 	if url == "" {
 		url = fmt.Sprintf("%s/v1/harvester/harvesterhci.io.virtualmachineimages/%s/%s?action=upload", host, ns, name)
 	} else {
 		if strings.HasPrefix(url, "/") {
 			url = host + url
 		}
 	}
 	
 	// If URL doesn't have query params, add ?, else &
 	sep := "?"
 	if strings.Contains(url, "?") {
 		sep = "&"
 	}
 	// size 参数必须是文件真实大小 (包含 padding)
 	if !strings.Contains(url, "size=") {
 		url = fmt.Sprintf("%s%ssize=%d", url, sep, finalFileSize)
 	}
 	
 	fmt.Printf("DEBUG: Final Upload URL: %s\n", url)

 	// ---------------------------------------------------------
	// 尝试使用 curl.exe 进行上传 (优先尝试，因为 Go multipart 处理 EOF 问题)
	// ---------------------------------------------------------
	/*
	if _, err := exec.LookPath("curl.exe"); err == nil && localFilePath != "" {
		fmt.Println("检测到 curl.exe，尝试使用 curl 进行上传...")
        // ... (commented out)
	}
    */
	
	// 5. 构造 Multipart Body (Go Native Fallback)
 	// 使用 mime/multipart 标准库来生成 Header 和 Footer

 	boundary := fmt.Sprintf("HarvesterBoundary%d", time.Now().UnixNano())
 	
 	// 5.1 构造 Header
 	headerBuf := &bytes.Buffer{}
 	// 手动构造符合 RFC 的 Header
 	// 格式:
 	// --boundary\r\n
 	// Content-Disposition: form-data; name="file"; filename="filename"\r\n
 	// Content-Type: application/octet-stream\r\n
 	// \r\n
 	fmt.Fprintf(headerBuf, "--%s\r\n", boundary)
	fmt.Fprintf(headerBuf, "Content-Disposition: form-data; name=\"chunk\"; filename=\"%s\"\r\n", filename)
	fmt.Fprintf(headerBuf, "Content-Type: application/octet-stream\r\n")
	fmt.Fprintf(headerBuf, "Content-Length: %d\r\n", finalFileSize)
	fmt.Fprintf(headerBuf, "\r\n")

 	// 5.2 构造 Footer
 	// 格式:
 	// \r\n
 	// --boundary--\r\n
 	footerBuf := &bytes.Buffer{}
 	fmt.Fprintf(footerBuf, "\r\n--%s--\r\n", boundary)

 	totalReqSize := int64(headerBuf.Len()) + finalFileSize + int64(footerBuf.Len())
 	fmt.Printf("DEBUG: Size Calc: Header=%d, File+Pad=%d, Footer=%d, Total=%d\n", headerBuf.Len(), finalFileSize, footerBuf.Len(), totalReqSize)

 	// 5.3 构造 Body 流
 	var fullStream io.Reader
 	
 	// 策略: 如果文件较小 (< 50MB)，直接读入内存构建，排除 io.MultiReader 问题
 	// 如果文件较大，使用 io.MultiReader
 	if totalReqSize < 50*1024*1024 {
 		fmt.Println("DEBUG: Small file detected, buffering entire body in memory...")
 		fullBuf := &bytes.Buffer{}
 		fullBuf.Write(headerBuf.Bytes())
 		
 		// Copy file content
 		// Reset reader if needed (but reader is io.Reader, assume at start)
 		if _, err := io.Copy(fullBuf, reader); err != nil {
 			return fmt.Errorf("buffer copy file failed: %v", err)
 		}
 		
 		// Padding
 		if padding > 0 {
 			fullBuf.Write(make([]byte, padding))
 		}
 		
 		fullBuf.Write(footerBuf.Bytes())
 		
 		fullStream = bytes.NewReader(fullBuf.Bytes())
 		// 更新 totalReqSize 确保一致 (虽然理论上一样)
 		totalReqSize = int64(fullBuf.Len())
 	} else {
 		// 大文件流式处理
 		var fileStream io.Reader = reader
 		if padding > 0 {
 			fileStream = io.MultiReader(reader, bytes.NewReader(make([]byte, padding)))
 		}
 		fullStream = io.MultiReader(headerBuf, fileStream, footerBuf)
 	}

 	// 6. 构造 HTTP Request
 	// 6.1 处理 URL (添加 size 参数)
 	host = strings.TrimSuffix(cfg.HarvesterHost, "/v3")
 	url = uploadUrl
 	if url == "" {
 		url = fmt.Sprintf("%s/v1/harvester/harvesterhci.io.virtualmachineimages/%s/%s?action=upload", host, ns, name)
 	} else {
 		if strings.HasPrefix(url, "/") {
 			url = host + url
 		}
 	}
 	
 	// If URL doesn't have query params, add ?, else &
 	sep = "?"
 	if strings.Contains(url, "?") {
 		sep = "&"
 	}
 	
 	// size 参数必须是文件真实大小 (包含 padding)
 	if !strings.Contains(url, "size=") {
 		url = fmt.Sprintf("%s%ssize=%d", url, sep, finalFileSize)
 	}
 	
 	fmt.Printf("DEBUG: Final Upload URL: %s\n", url)
  
 	req, _ := http.NewRequest("POST", url, fullStream)
 	req.Header.Set("Authorization", "Bearer "+cfg.HarvesterToken)
 	req.Header.Set("Content-Type", fmt.Sprintf("multipart/form-data; boundary=%s", boundary))
 	// req.Header.Set("Content-Length", strconv.FormatInt(totalReqSize, 10))
	// req.ContentLength = totalReqSize
 	
 	// 禁用 Expect: 100-continue，防止某些反向代理或 Server 处理不当
 	// req.Header.Set("Expect", "") // Go default behavior might add it for large requests
   	
   	// Debug: Dump request headers

	// Debug: Dump request headers
	dump, _ := httputil.DumpRequestOut(req, false)
	fmt.Printf("\n[DEBUG] Request Headers:\n%s\n", string(dump))
	
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Cloudmap Error %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

const indexHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>Cloudmap 镜像直传（直连模式）</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto;max-width:760px;margin:24px auto;padding:0 16px}
    h1{font-size:20px}
    label{display:block;margin:12px 0 6px}
    input,select,button{width:100%;padding:10px;font-size:14px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .actions{margin-top:16px}
    .note{color:#666;font-size:12px}
    .ok{color:#0a0}
    .err{color:#a00}
    .progress{height:10px;background:#eee;border-radius:6px;overflow:hidden;margin-top:8px}
    .bar{height:10px;background:#4caf50;width:0%}
    .progress-text{font-size:12px;margin-top:6px;color:#333}
  </style>
</head>
<body>
  <h1>Cloudmap 镜像直传（直连模式）</h1>
  <p class="note">本工具直接连接 Cloudmap：创建镜像元数据并上传本地文件，无需 Tower。</p>
  <label>Cloudmap 地址</label>
  <input id="harvesterUrl" placeholder="https://x.x.x.x"/>
  <label>Cloudmap Token</label>
  <input id="harvesterToken" placeholder="Bearer Token"/>
  <div class="row">
    <div>
      <label>命名空间</label>
      <input id="namespace" value="default"/>
    </div>
    <div>
      <label>镜像显示名称</label>
      <input id="displayName" placeholder="ubuntu-20.04"/>
    </div>
  </div>
  <label>镜像类型</label>
  <select id="imageType">
    <option value="">自动推断</option>
    <option value="disk">Qcow2（磁盘镜像）</option>
    <option value="iso">ISO（光盘镜像）</option>
  </select>
  <label>镜像文件</label>
  <input id="file" type="file"/>
  <div class="actions">
    <button onclick="submit()">开始上传</button>
  </div>
  <p id="msg"></p>
  <div class="progress"><div id="bar" class="bar"></div></div>
  <div id="ptxt" class="progress-text"></div>
  <script>
    async function submit(){
      const file = document.getElementById('file').files[0];
      if(!file){ document.getElementById('msg').textContent='请先选择文件'; document.getElementById('msg').className='err'; return; }
      const fd = new FormData();
      fd.append('harvesterUrl', document.getElementById('harvesterUrl').value.trim());
      fd.append('harvesterToken', document.getElementById('harvesterToken').value.trim());
      fd.append('namespace', document.getElementById('namespace').value.trim());
      const dn1 = document.getElementById('displayName').value.trim();
      fd.append('displayName', dn1);
      const imageType = document.getElementById('imageType').value.trim();
      if (imageType) {
        fd.append('imageType', imageType);
      }
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST','/api/upload-direct');
      const bar = document.getElementById('bar');
      const ptxt = document.getElementById('ptxt');
      const msg = document.getElementById('msg');
      xhr.upload.onprogress = (e)=>{
        if(e.lengthComputable){
          const pct = (e.loaded/e.total)*100;
          bar.style.width = pct.toFixed(1) + '%';
          const mbLoaded = (e.loaded/1048576).toFixed(2);
          const mbTotal = (e.total/1048576).toFixed(2);
          ptxt.textContent = '上传进度: ' + pct.toFixed(1) + '% (' + mbLoaded + '/' + mbTotal + ' MB)';
        }else{
          ptxt.textContent = '正在上传...';
        }
      };
      xhr.onload = ()=>{
        msg.textContent = xhr.responseText || '完成';
        msg.className = xhr.status>=200 && xhr.status<300 ? 'ok' : 'err';
      };
      xhr.onerror = ()=>{
        msg.textContent = '连接服务器失败 (请查看工具运行窗口的日志)';
        msg.className = 'err';
      };
      msg.textContent = '开始上传...';
      msg.className = '';
      bar.style.width = '0%';
      ptxt.textContent = '';
      xhr.send(fd);
    }
  </script>
</body>
</html>`

func runTestServer() {
	fmt.Println("启动本地测试服务器: http://127.0.0.1:9999")
	fmt.Println("等待上传请求...")
	
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("\n--- [Test Server] Received Request ---\n")
		fmt.Printf("Method: %s\n", r.Method)
		fmt.Printf("URL: %s\n", r.URL.String())
		fmt.Printf("Content-Length: %d (Header: %s)\n", r.ContentLength, r.Header.Get("Content-Length"))
		
		dump, _ := httputil.DumpRequest(r, false)
		fmt.Printf("Headers:\n%s\n", string(dump))
		
		// Read some body to verify
		mr, err := r.MultipartReader()
		if err != nil {
			fmt.Printf("MultipartReader Error: %v\n", err)
		} else {
			for {
				p, err := mr.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					fmt.Printf("NextPart Error: %v\n", err)
					break
				}
				fmt.Printf("Part: %s, FileName: %s\n", p.FormName(), p.FileName())
				// Consume part
				io.Copy(io.Discard, p)
			}
		}

		w.WriteHeader(200)
		w.Write([]byte("Test Server OK"))
	})
	
	http.ListenAndServe(":9999", nil)
}

func startGUI() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, indexHTML)
	})
	mux.HandleFunc("/api/upload-direct", func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				fmt.Printf("[PANIC] %v\n", rec)
				w.WriteHeader(500)
				io.WriteString(w, fmt.Sprintf("Server Panic: %v", rec))
			}
		}()

		fmt.Println("收到上传请求...")
		
		// 增加 maxMemory 到 512MB，减少磁盘 I/O 压力
		if err := r.ParseMultipartForm(512 << 20); err != nil {
			fmt.Printf("解析表单失败: %v\n", err)
			w.WriteHeader(400)
			io.WriteString(w, "表单解析失败: "+err.Error())
			return
		}

		harvUrl := strings.TrimRight(r.FormValue("harvesterUrl"), "/")
		harvToken := r.FormValue("harvesterToken")
		ns := r.FormValue("namespace")
		display := r.FormValue("displayName")
		imageType := strings.ToLower(r.FormValue("imageType"))
		
		file, header, err := r.FormFile("file")
		if err != nil {
			fmt.Println("未找到文件")
			w.WriteHeader(400)
			io.WriteString(w, "缺少文件")
			return
		}
		defer file.Close()

		fmt.Printf("目标: %s, 命名空间: %s, 镜像: %s, 类型: %s, 文件: %s (%d bytes)\n", harvUrl, ns, display, imageType, header.Filename, header.Size)

		cfg := Config{HarvesterHost: normalizeHost(harvUrl), HarvesterToken: harvToken}
		
		fmt.Println("正在创建镜像元数据...")
		name, uploadUrl, err := createHarvesterImage(cfg, ns, display, imageType)
		if err != nil {
			fmt.Printf("创建镜像失败: %v\n", err)
			w.WriteHeader(500)
			io.WriteString(w, "创建镜像失败: "+err.Error())
			return
		}
		fmt.Printf("镜像创建成功: %s\n", name)

		fmt.Println("正在上传文件流...")
		if err := uploadReaderToHarvester(cfg, ns, name, header.Filename, "", uploadUrl, header.Size, file); err != nil {
			fmt.Printf("上传文件失败: %v\n", err)
			w.WriteHeader(500)
			io.WriteString(w, "上传文件失败: "+err.Error())
			return
		}
		
		fmt.Println("上传完成")
		io.WriteString(w, "上传成功")
	})
	go func() {
		http.ListenAndServe("127.0.0.1:8787", mux)
	}()
	exec.Command("rundll32", "url.dll,FileProtocolHandler", "http://127.0.0.1:8787/").Start()
	fmt.Println("图形界面已启动: http://127.0.0.1:8787/")
	select {}
}
