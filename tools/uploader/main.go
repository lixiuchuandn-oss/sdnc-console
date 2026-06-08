package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net"
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
	Type     string `json:"type"`
	Config   struct {
		Endpoint string `json:"endpoint"`
		Provider string `json:"provider"`
	} `json:"config"`
}

type CloudDetailResponse struct {
	Id       string `json:"id"`
	Endpoint string `json:"endpoint"`
}

type UploadTokenApiResponse struct {
	Data struct {
		Namespace          string `json:"namespace"`
		ServiceAccountName string `json:"serviceAccountName"`
		ExpirationSeconds  int    `json:"expirationSeconds"`
		Token              string `json:"token"`
		ExpiresAt          string `json:"expiresAt"`
	} `json:"data"`
}

type LoginApiResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type LoginPublicKeyResponse struct {
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
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

// uploaderBuildID 直传版构建标识（控制台与页面可见；后端据此校验可下发二进制）。
const uploaderBuildID = "direct-harvester-20260608"

var reader = bufio.NewReader(os.Stdin)

func newHarvesterHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 0,
		Transport: &http.Transport{
			TLSClientConfig:       &tls.Config{InsecureSkipVerify: true},
			ResponseHeaderTimeout: 0,
			DisableCompression:    true,
			ExpectContinueTimeout: 2 * time.Second,
		},
	}
}

var client = newHarvesterHTTPClient()

func main() {
	gui := flag.Bool("gui", false, "启动本地图形界面")
	direct := flag.Bool("direct", false, "直连 Cloudmap（跳过 Tower）")
	testServer := flag.Bool("test-server", false, "启动本地测试服务器 (Debug)")
	
	// CLI Args for direct mode
	argUrl := flag.String("url", "", "Cloudmap URL")
	argToken := flag.String("token", "", "Cloudmap Token")
	argTowerUrl := flag.String("tower-url", "", "Tower URL（用于签发短期上传Token）")
	argTowerToken := flag.String("tower-token", "", "Tower 用户 Token（用于签发短期上传Token）")
	argCloudId := flag.String("cloud-id", "", "资源池 Cloud ID（用于签发短期上传Token）")
	argServiceAccount := flag.String("sa", "image-uploader", "上传 ServiceAccount 名称")
	argExpireSeconds := flag.Int("expire", 300, "短期Token有效期（秒，60-600）")
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
			// 优先尝试通过 Tower 签发短期 token（推荐）
			towerURL := strings.TrimSpace(*argTowerUrl)
			towerToken := strings.TrimSpace(*argTowerToken)
			cloudID := strings.TrimSpace(*argCloudId)
			if towerURL != "" && towerToken != "" && cloudID != "" {
				host, token, err := issueUploadTokenFromTower(
					towerURL,
					towerToken,
					cloudID,
					*argNs,
					strings.TrimSpace(*argServiceAccount),
					*argExpireSeconds,
				)
				if err != nil {
					fmt.Printf("通过 Tower 签发短期 token 失败: %v\n", err)
					return
				}
				cfg.HarvesterHost = normalizeHost(host)
				cfg.HarvesterToken = token
				fmt.Println("已通过 Tower 获取短期上传 token")
			} else {
				cfg.HarvesterToken = prompt("Cloudmap Token: ")
			}
		}

		var ns string
		// Only prompt for namespace if we are in interactive mode (inferred from missing URL)
		if *argUrl == "" {
			ns = prompt("项目 [默认 default]: ")
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
	namespace := prompt("项目 [默认 default]: ")
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
	fmt.Println("优先通过 Tower 签发短期上传 Token（推荐，避免暴露资源池长期令牌）")
	hostFromTower, tokenFromTower, signErr := issueUploadTokenFromTower(
		config.TowerURL,
		config.TowerToken,
		selectedCloud.Id,
		namespace,
		"image-uploader",
		300,
	)
	if signErr != nil {
		fmt.Printf("Tower 签发短期 token 失败: %v\n", signErr)
		fmt.Println("将回退为手工输入 Cloudmap Token")
		fmt.Println("请输入 Cloudmap 集群 API Token (非 Tower Token)")
		config.HarvesterToken = prompt("Bearer Token: ")
	} else {
		config.HarvesterHost = normalizeHost(hostFromTower)
		config.HarvesterToken = tokenFromTower
		fmt.Println("已通过 Tower 获取短期上传 token")
	}

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

// normalizeTowerURL 规范化 Tower API 根地址；Windows 下 localhost 常解析到 ::1 导致连不上仅监听 127.0.0.1 的后端。
func normalizeTowerURL(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return raw
	}
	if strings.EqualFold(u.Hostname(), "localhost") {
		if port := u.Port(); port != "" {
			u.Host = "127.0.0.1:" + port
		} else {
			u.Host = "127.0.0.1"
		}
	}
	return strings.TrimRight(u.String(), "/")
}

func wrapTowerConnError(action string, err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "connection refused") || strings.Contains(msg, "connectex") {
		return fmt.Errorf(
			"%s: 无法连接 Tower 后端（%v）。请确认 backend 已启动（npm run dev，默认 5001 端口），Tower 地址填 http://127.0.0.1:5001（不是 5000 前端）",
			action,
			err,
		)
	}
	return fmt.Errorf("%s: %v", action, err)
}

func fetchHarvesterClouds(cfg Config) ([]Cloud, error) {
	req, _ := http.NewRequest("GET", cfg.TowerURL+"/api/clouds", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.TowerToken)
	resp, err := client.Do(req)
	if err != nil {
		return nil, wrapTowerConnError("拉取云平台列表失败", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 { return nil, fmt.Errorf("HTTP %d", resp.StatusCode) }

	body, _ := io.ReadAll(resp.Body)
	var all []Cloud
	// 兼容三种常见返回：[] / {items:[]} / {data:{items:[]}}
	if err := json.Unmarshal(body, &all); err != nil || len(all) == 0 {
		var wrap1 struct {
			Items []Cloud `json:"items"`
		}
		if err1 := json.Unmarshal(body, &wrap1); err1 == nil && len(wrap1.Items) > 0 {
			all = wrap1.Items
		} else {
			var wrap2 struct {
				Data struct {
					Items []Cloud `json:"items"`
				} `json:"data"`
			}
			if err2 := json.Unmarshal(body, &wrap2); err2 == nil && len(wrap2.Data.Items) > 0 {
				all = wrap2.Data.Items
			}
		}
	}
	if all == nil {
		all = []Cloud{}
	}

	list := make([]Cloud, 0, len(all))
	for _, c := range all {
		pCandidates := []string{
			strings.ToLower(strings.TrimSpace(c.Provider)),
			strings.ToLower(strings.TrimSpace(c.Config.Provider)),
			strings.ToLower(strings.TrimSpace(c.Type)),
		}
		match := false
		for _, p := range pCandidates {
			if p == "harvester" || strings.HasPrefix(p, "cloudmap") {
				match = true
				break
			}
		}
		if match {
			list = append(list, c)
		}
	}
	return list, nil
}

func fetchLoginPublicKey(towerURL string) (*LoginPublicKeyResponse, error) {
	towerURL = normalizeTowerURL(towerURL)
	req, err := http.NewRequest("GET", towerURL+"/api/auth/login-public-key", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, wrapTowerConnError("获取登录公钥失败", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusServiceUnavailable {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("获取登录公钥失败: HTTP %d %s", resp.StatusCode, string(respBody))
	}
	var info LoginPublicKeyResponse
	if err := json.Unmarshal(respBody, &info); err != nil {
		return nil, fmt.Errorf("解析登录公钥失败: %v", err)
	}
	if strings.TrimSpace(info.PublicKey) == "" {
		return nil, fmt.Errorf("登录公钥响应无效")
	}
	return &info, nil
}

func loginPasswordNonce() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func encryptLoginPassword(publicKeyPEM, password string) (string, error) {
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return "", fmt.Errorf("登录公钥 PEM 无效")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("解析登录公钥失败: %w", err)
	}
	rsaPub, ok := pubAny.(*rsa.PublicKey)
	if !ok {
		return "", fmt.Errorf("登录公钥不是 RSA 密钥")
	}
	payload, err := json.Marshal(map[string]any{
		"password": password,
		"ts":       time.Now().UnixMilli(),
		"nonce":    loginPasswordNonce(),
	})
	if err != nil {
		return "", err
	}
	cipher, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, rsaPub, payload, nil)
	if err != nil {
		return "", fmt.Errorf("RSA 加密失败: %w", err)
	}
	return base64.StdEncoding.EncodeToString(cipher), nil
}

func buildLoginRequestBody(towerURL, username, password string) (map[string]string, error) {
	keyInfo, err := fetchLoginPublicKey(towerURL)
	if err != nil {
		return nil, err
	}
	if keyInfo != nil {
		cipher, err := encryptLoginPassword(keyInfo.PublicKey, password)
		if err != nil {
			return nil, err
		}
		body := map[string]string{
			"username": username,
			"cipher":   cipher,
		}
		if kid := strings.TrimSpace(keyInfo.KeyID); kid != "" {
			body["keyId"] = kid
		}
		return body, nil
	}
	return map[string]string{
		"username": username,
		"password": password,
	}, nil
}

func loginTower(towerURL, username, password string) (string, error) {
	towerURL = normalizeTowerURL(towerURL)
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)
	if towerURL == "" || username == "" || password == "" {
		return "", fmt.Errorf("缺少登录参数")
	}
	bodyMap, err := buildLoginRequestBody(towerURL, username, password)
	if err != nil {
		return "", err
	}
	body, _ := json.Marshal(bodyMap)
	req, _ := http.NewRequest("POST", towerURL+"/api/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", wrapTowerConnError("登录请求失败", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("登录失败: HTTP %d %s", resp.StatusCode, string(respBody))
	}
	var lr LoginApiResponse
	if err := json.Unmarshal(respBody, &lr); err != nil {
		return "", fmt.Errorf("解析登录响应失败: %v", err)
	}
	if strings.TrimSpace(lr.Token) == "" {
		return "", fmt.Errorf("登录响应缺少 token")
	}
	return lr.Token, nil
}

func fetchCloudNamespaces(towerURL, towerToken, cloudID string) ([]string, error) {
	towerURL = normalizeTowerURL(towerURL)
	towerToken = strings.TrimSpace(towerToken)
	cloudID = strings.TrimSpace(cloudID)
	if towerURL == "" || towerToken == "" || cloudID == "" {
		return nil, fmt.Errorf("缺少查询项目参数")
	}
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/clouds/%s/resources/harvester/namespaces?excludeSystem=true", towerURL, cloudID), nil)
	req.Header.Set("Authorization", "Bearer "+towerToken)
	resp, err := client.Do(req)
	if err != nil {
		return nil, wrapTowerConnError("查询项目失败", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("查询项目失败: HTTP %d %s", resp.StatusCode, string(b))
	}
	var raw struct {
		Data struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, fmt.Errorf("解析项目响应失败: %v", err)
	}
	list := make([]string, 0, len(raw.Data.Items))
	seen := map[string]bool{}
	for _, item := range raw.Data.Items {
		name, _ := item["name"].(string)
		if strings.TrimSpace(name) == "" {
			if md, ok := item["metadata"].(map[string]any); ok {
				if n2, ok2 := md["name"].(string); ok2 {
					name = n2
				}
			}
		}
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		list = append(list, name)
	}
	return list, nil
}

// uploadDirectToHarvesterViaTower 经 Tower 创建镜像元数据，文件直传 Harvester 底座（不经 Tower 代传）。
func uploadDirectToHarvesterViaTower(
	towerURL, towerToken, cloudID, namespace, displayName, imageType string,
	file multipart.File,
	header *multipart.FileHeader,
) error {
	towerURL = normalizeTowerURL(towerURL)
	if towerURL == "" || strings.TrimSpace(towerToken) == "" || strings.TrimSpace(cloudID) == "" {
		return fmt.Errorf("缺少 Tower 上传参数")
	}
	ns := strings.TrimSpace(namespace)
	if ns == "" {
		ns = "default"
	}
	display := strings.TrimSpace(displayName)
	if display == "" {
		display = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	if display == "" {
		display = header.Filename
	}

	host, harvesterToken, err := issueUploadTokenFromTower(
		towerURL,
		towerToken,
		cloudID,
		ns,
		"image-uploader",
		300,
	)
	if err != nil {
		return fmt.Errorf("签发上传凭证失败: %w", err)
	}

	cfg := Config{
		TowerURL:       towerURL,
		TowerToken:     towerToken,
		HarvesterHost:  normalizeHost(host),
		HarvesterToken: harvesterToken,
	}

	fmt.Print("[1/3] 在 Tower 创建镜像记录... ")
	imgMeta, err := createTowerImage(cfg, cloudID, ns, display, imageType)
	if err != nil {
		return fmt.Errorf("创建镜像记录失败: %w", err)
	}
	imgNs := strings.TrimSpace(imgMeta.Metadata.Namespace)
	if imgNs == "" {
		imgNs = ns
	}
	imgName := strings.TrimSpace(imgMeta.Metadata.Name)
	if imgName == "" {
		return fmt.Errorf("创建镜像记录失败: 未返回镜像名称")
	}
	fmt.Printf("成功 (Name: %s)\n", imgName)

	fmt.Println("[2/3] 等待资源初始化...")
	time.Sleep(3 * time.Second)

	fileSize := header.Size
	if fileSize <= 0 {
		if st, statErr := file.Seek(0, io.SeekEnd); statErr == nil {
			fileSize = st
			_, _ = file.Seek(0, io.SeekStart)
		}
	}

	fmt.Println("[3/3] 正在直传文件到底座（请勿关闭窗口）...")
	progressReader := &ProgressReader{
		Reader: file,
		Total:  fileSize,
		Start:  time.Now(),
	}
	if err := uploadReaderToHarvester(
		cfg,
		imgNs,
		imgName,
		header.Filename,
		"",
		"",
		fileSize,
		progressReader,
	); err != nil {
		return fmt.Errorf("直传底座失败: %w", err)
	}
	fmt.Println()

	ready, checkErr := checkImageStatus(cfg, imgNs, imgName)
	if checkErr != nil {
		fmt.Printf("提示: 文件已传到底座，导入状态检查未完成: %v\n", checkErr)
		return nil
	}
	if !ready {
		fmt.Println("提示: 文件已传到底座，导入仍在进行中，请在 Tower 镜像列表查看「同步中」进度")
	}
	return nil
}

func issueUploadTokenFromTower(
	towerURL string,
	towerToken string,
	cloudID string,
	namespace string,
	serviceAccountName string,
	expirationSeconds int,
) (string, string, error) {
	towerURL = normalizeTowerURL(towerURL)
	towerToken = strings.TrimSpace(towerToken)
	cloudID = strings.TrimSpace(cloudID)
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		namespace = "default"
	}
	if serviceAccountName == "" {
		serviceAccountName = "image-uploader"
	}
	if expirationSeconds < 60 {
		expirationSeconds = 60
	}
	if expirationSeconds > 600 {
		expirationSeconds = 600
	}
	if towerURL == "" || towerToken == "" || cloudID == "" {
		return "", "", fmt.Errorf("缺少 Tower 签发参数")
	}

	// 1) 查询 cloud 详情，获取 endpoint
	getReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/clouds/%s", towerURL, cloudID), nil)
	getReq.Header.Set("Authorization", "Bearer "+towerToken)
	getResp, err := client.Do(getReq)
	if err != nil {
		return "", "", wrapTowerConnError("查询资源池失败", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != 200 {
		b, _ := io.ReadAll(getResp.Body)
		return "", "", fmt.Errorf("查询资源池失败: HTTP %d %s", getResp.StatusCode, string(b))
	}
	var cloudDetail CloudDetailResponse
	if err := json.NewDecoder(getResp.Body).Decode(&cloudDetail); err != nil {
		return "", "", fmt.Errorf("解析资源池详情失败: %v", err)
	}
	if strings.TrimSpace(cloudDetail.Endpoint) == "" {
		return "", "", fmt.Errorf("资源池 endpoint 为空")
	}

	// 2) 调用上传短期 token 接口
	bodyMap := map[string]any{
		"namespace":          namespace,
		"serviceAccountName": serviceAccountName,
		"expirationSeconds":  expirationSeconds,
	}
	body, _ := json.Marshal(bodyMap)
	postReq, _ := http.NewRequest(
		"POST",
		fmt.Sprintf("%s/api/clouds/%s/resources/harvester/images/upload-token", towerURL, cloudID),
		bytes.NewBuffer(body),
	)
	postReq.Header.Set("Authorization", "Bearer "+towerToken)
	postReq.Header.Set("Content-Type", "application/json")
	postResp, err := client.Do(postReq)
	if err != nil {
		return "", "", wrapTowerConnError("签发上传 token 失败", err)
	}
	defer postResp.Body.Close()
	respBody, _ := io.ReadAll(postResp.Body)
	if postResp.StatusCode < 200 || postResp.StatusCode > 299 {
		return "", "", fmt.Errorf("签发上传 token 失败: HTTP %d %s", postResp.StatusCode, string(respBody))
	}

	var tokenResp UploadTokenApiResponse
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return "", "", fmt.Errorf("解析上传 token 响应失败: %v", err)
	}
	if strings.TrimSpace(tokenResp.Data.Token) == "" {
		return "", "", fmt.Errorf("上传 token 响应为空")
	}

	return cloudDetail.Endpoint, tokenResp.Data.Token, nil
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
		"namespace":     payload.Namespace,
		"displayName":   payload.DisplayName,
		"sourceType":    payload.SourceType,
		"uploadChannel": "desktop-uploader",
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

const harvesterCdiUploadProbeBytes = 1024

func minMultipartFilePrefixBytes(multipartHeaderLength int) int {
	head := multipartHeaderLength
	if head < 0 {
		head = 0
	}
	if head >= harvesterCdiUploadProbeBytes {
		return 512
	}
	return harvesterCdiUploadProbeBytes - head
}

func truncateHarvesterErrorBody(body string, max int) string {
	body = strings.TrimSpace(body)
	if max <= 0 || len(body) <= max {
		return body
	}
	return body[:max] + "..."
}

func formatHarvesterUploadHTTPError(status int, body string) error {
	trimmed := truncateHarvesterErrorBody(body, 800)
	if status == 504 || strings.Contains(strings.ToLower(trimmed), "gateway time-out") {
		return fmt.Errorf(
			"Cloudmap Error %d: 网关超时（上传耗时超过 Harvester 入口 nginx 的 proxy_read_timeout）。请让管理员将 proxy_read_timeout、proxy_send_timeout、client_body_timeout 调至 ≥3600s，或检查网络与底座负载。响应: %s",
			status,
			truncateHarvesterErrorBody(trimmed, 200),
		)
	}
	return fmt.Errorf("Cloudmap Error %d: %s", status, trimmed)
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

	headerBytes := headerBuf.Bytes()
	footerBytes := footerBuf.Bytes()
	contentLength := int64(len(headerBytes)) + finalFileSize + int64(len(footerBytes))
	fmt.Printf(
		"DEBUG: Size Calc: Header=%d, File+Pad=%d, Footer=%d, Total=%d\n",
		len(headerBytes),
		finalFileSize,
		len(footerBytes),
		contentLength,
	)

	prefixNeed := minMultipartFilePrefixBytes(len(headerBytes))
	filePrefix := make([]byte, prefixNeed)
	prefixN, prefixErr := io.ReadFull(reader, filePrefix)
	if prefixErr != nil && prefixErr != io.EOF && prefixErr != io.ErrUnexpectedEOF {
		return fmt.Errorf("读取文件头失败: %w", prefixErr)
	}
	filePrefix = filePrefix[:prefixN]

	uploadClient := newHarvesterHTTPClient()
	pipeReader, pipeWriter := io.Pipe()
	req, err := http.NewRequest("POST", url, pipeReader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.HarvesterToken)
	req.Header.Set("Content-Type", fmt.Sprintf("multipart/form-data; boundary=%s", boundary))
	req.Header.Set("Expect", "")
	req.ContentLength = contentLength

	pumpErrCh := make(chan error, 1)
	go func() {
		var pumpErr error
		defer func() {
			_ = pipeWriter.CloseWithError(pumpErr)
			pumpErrCh <- pumpErr
		}()
		writeAll := func(p []byte) error {
			if len(p) == 0 {
				return nil
			}
			_, err := pipeWriter.Write(p)
			return err
		}
		if pumpErr = writeAll(headerBytes); pumpErr != nil {
			return
		}
		if pumpErr = writeAll(filePrefix); pumpErr != nil {
			return
		}
		if _, pumpErr = io.Copy(pipeWriter, reader); pumpErr != nil {
			return
		}
		if padding > 0 {
			if pumpErr = writeAll(make([]byte, padding)); pumpErr != nil {
				return
			}
		}
		pumpErr = writeAll(footerBytes)
	}()

	resp, doErr := uploadClient.Do(req)
	pumpErr := <-pumpErrCh
	if doErr != nil {
		return doErr
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if pumpErr != nil {
		return fmt.Errorf("上传流写入失败: %w", pumpErr)
	}
	if resp.StatusCode != 200 {
		return formatHarvesterUploadHTTPError(resp.StatusCode, string(body))
	}
	return nil
}

const indexHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>镜像直传工具 · 直连 Cloudmap</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    /* 与 Compute Tower 前端一致：Ant Design 浅色、主色 #1677ff、顶栏同源蓝渐变 */
    :root {
      --color-primary: #1677ff;
      --color-primary-hover: #4096ff;
      --color-primary-active: #0958d9;
      --header-start: #0a4cc0;
      --header-end: #1b64ed;
      --bg-page: #f0f2f5;
      --bg-card: #ffffff;
      --bg-input: #ffffff;
      --border: #d9d9d9;
      --text: rgba(0, 0, 0, 0.88);
      --text-secondary: rgba(0, 0, 0, 0.45);
      --text-tertiary: rgba(0, 0, 0, 0.25);
      --success: #52c41a;
      --danger: #ff4d4f;
      --radius: 6px;
      --shadow-card: 0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg-page);
      color: var(--text);
      padding: 28px 16px 48px;
    }
    .wrap {
      max-width: 650px;
      margin: 0 auto;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 2px);
      box-shadow: var(--shadow-card);
      padding: 28px 26px 32px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 4px;
    }
    .brand-icon {
      width: 34px;
      height: 34px;
      border-radius: var(--radius);
      background: linear-gradient(135deg, var(--header-start) 0%, var(--header-end) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
      line-height: 1;
      color: #fff;
      box-shadow: 0 2px 8px rgba(10, 76, 192, 0.35);
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .subtitle {
      margin: 0 0 24px;
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.55;
    }
    .field { margin-bottom: 18px; }
    label {
      display: block;
      font-size: 14px;
      font-weight: 400;
      color: var(--text);
      margin-bottom: 8px;
    }
    input[type="text"], input[type="password"], select {
      width: 100%;
      padding: 10px 11px;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.5715;
      color: var(--text);
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    input::placeholder { color: var(--text-tertiary); }
    input:focus, select:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);
    }
    .file-picker {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 46px;
      padding: 6px 10px 6px 6px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color .15s, box-shadow .15s;
    }
    .file-picker:focus-within {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);
    }
    .file-picker input[type="file"] {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      color: var(--text);
      cursor: pointer;
      border: none;
      background: transparent;
      padding: 4px 2px;
    }
    .file-picker input[type="file"]::file-selector-button,
    .file-picker input[type="file"]::-webkit-file-upload-button {
      margin-right: 12px;
      padding: 6px 14px;
      font-size: 14px;
      font-weight: 400;
      font-family: inherit;
      color: #fff;
      background: var(--color-primary);
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      transition: background .15s;
    }
    .file-picker input[type="file"]::file-selector-button:hover,
    .file-picker input[type="file"]::-webkit-file-upload-button:hover {
      background: var(--color-primary-hover);
    }
    .row2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 18px;
    }
    @media (max-width: 480px) { .row2 { grid-template-columns: 1fr; } }
    .btn {
      width: 100%;
      margin-top: 8px;
      padding: 10px 15px;
      font-size: 14px;
      font-weight: 400;
      font-family: inherit;
      line-height: 1.5715;
      color: #fff;
      background: var(--color-primary);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius);
      cursor: pointer;
      box-shadow: 0 2px 0 rgba(5, 145, 255, 0.1);
      transition: background .15s, border-color .15s, transform .08s;
    }
    .btn:hover {
      background: var(--color-primary-hover);
      border-color: var(--color-primary-hover);
    }
    .btn:active {
      background: var(--color-primary-active);
      border-color: var(--color-primary-active);
      transform: translateY(0);
    }
    #msg {
      min-height: 22px;
      margin-top: 16px;
      font-size: 14px;
      line-height: 1.5;
    }
    .ok { color: var(--success); }
    .err { color: var(--danger); }
    .progress {
      height: 8px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 999px;
      overflow: hidden;
      margin-top: 12px;
    }
    .bar {
      height: 100%;
      background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-hover) 100%);
      width: 0%;
      border-radius: 999px;
      transition: width .12s ease-out;
    }
    .progress-text { font-size: 12px; margin-top: 8px; color: var(--text-secondary); }
    .hint { font-size: 12px; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; }
    .section-title {
      margin: 2px 0 12px;
      padding-left: 10px;
      border-left: 3px solid var(--color-primary);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }
    .section {
      border: 1px dashed #d6e4ff;
      border-radius: var(--radius);
      padding: 14px 12px 10px;
      margin-bottom: 14px;
      background: #fcfdff;
    }
    .status-panel {
      margin-bottom: 14px;
      padding: 10px 12px;
      border-radius: var(--radius);
      border: 1px solid #d9d9d9;
      background: #fafafa;
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-secondary);
      min-height: 42px;
      display: flex;
      align-items: center;
    }
    .status-panel.ok {
      background: #f6ffed;
      border-color: #b7eb8f;
      color: #389e0d;
    }
    .status-panel.err {
      background: #fff2f0;
      border-color: #ffccc7;
      color: #cf1322;
    }
    .actions-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .actions-row .btn {
      margin-top: 0;
      flex: 1;
    }
    .status-inline {
      font-size: 12px;
      color: var(--text-secondary);
      min-height: 18px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="brand">
        <div class="brand-icon" aria-hidden="true">⬆</div>
        <div>
          <h1>镜像上传工具</h1>
        </div>
      </div>
      <div id="statusPanel" class="status-panel">请先登录平台账号，然后选择 Cloudmap 云平台与项目。本工具将文件直传到底座（不经 Tower upload-tasks 代传）。</div>
      <div class="hint" style="margin:-8px 0 12px 0">构建标识：BUILD_ID_PLACEHOLDER</div>
      <div class="section">
        <div class="section-title">登录区域</div>
        <div class="row2">
          <div class="field" style="margin-bottom:0">
            <label>Tower 地址</label>
            <input id="towerUrl" type="text" placeholder="http://127.0.0.1:5001" autocomplete="off"/>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>用户名</label>
            <input id="username" type="text" placeholder="平台用户名" autocomplete="off"/>
          </div>
        </div>
        <div class="row2">
          <div class="field" style="margin-bottom:0">
            <label>密码</label>
            <input id="password" type="password" placeholder="平台密码" autocomplete="off"/>
          </div>
          <div class="field" style="margin-bottom:0"></div>
        </div>
        <div class="actions-row">
          <button type="button" class="btn" onclick="doLogin()">登录并加载资源</button>
        </div>
        <div id="loginHint" class="status-inline"></div>
      </div>

      <div class="section">
        <div class="section-title">镜像上传区域</div>
        <div class="row2">
          <div class="field" style="margin-bottom:0">
            <label>Cloudmap 云平台</label>
            <select id="cloudId"></select>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>项目</label>
            <select id="namespace"></select>
          </div>
        </div>
        <div class="row2">
          <div class="field" style="margin-bottom:0">
            <label>镜像显示名称</label>
            <input id="displayName" type="text" placeholder="如 ubuntu-20.04" autocomplete="off"/>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>镜像类型</label>
            <select id="imageType">
              <option value="disk" selected>Qcow2（磁盘镜像）</option>
              <option value="iso">ISO（光盘镜像）</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>镜像文件</label>
          <div class="file-picker">
            <input id="file" type="file" accept=".iso,.qcow2,.qcow,.img,.raw"/>
          </div>
          <p class="hint">支持 ISO / QCOW2 等大文件；上传过程中请勿关闭本窗口。</p>
        </div>
        <button type="button" class="btn" onclick="submit()">开始上传</button>
        <div id="uploadHint" class="status-inline"></div>
        <div class="progress"><div id="bar" class="bar"></div></div>
        <div id="ptxt" class="progress-text"></div>
      </div>
    </div>
  </div>
  <script>
    function setMsg(text, ok){
      const panel = document.getElementById('statusPanel');
      panel.textContent = text || '';
      panel.className = 'status-panel' + (ok === true ? ' ok' : (ok === false ? ' err' : ''));
    }
    function setLoginHint(text){
      document.getElementById('loginHint').textContent = text || '';
    }
    function setUploadHint(text){
      document.getElementById('uploadHint').textContent = text || '';
    }
    function fillSelect(id, items, valueKey='value', labelKey='label'){
      const el = document.getElementById(id);
      el.innerHTML = '';
      (items || []).forEach(it=>{
        const op = document.createElement('option');
        op.value = it[valueKey];
        op.textContent = it[labelKey];
        el.appendChild(op);
      });
    }
    async function loadNamespaces(){
      const towerUrl = document.getElementById('towerUrl').value.trim();
      const cloudId = document.getElementById('cloudId').value.trim();
      if(!towerUrl || !cloudId){
        fillSelect('namespace', [{value:'default', label:'default'}]);
        return;
      }
      const res = await fetch('/api/namespaces', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ towerUrl, cloudId })
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){
        throw new Error(data.message || '加载项目失败');
      }
      const nss = Array.isArray(data.namespaces) ? data.namespaces : [];
      if(nss.length===0){
        fillSelect('namespace', [{value:'default', label:'default'}]);
      }else{
        fillSelect('namespace', nss.map(ns=>({value:ns,label:ns})));
      }
    }
    async function doLogin(){
      try{
        const towerUrl = document.getElementById('towerUrl').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        if(!towerUrl || !username || !password){
          setMsg('请填写 Tower 地址、用户名、密码', false);
          setLoginHint('登录参数未填写完整。');
          return;
        }
        setMsg('登录中...');
        setLoginHint('正在验证账号并拉取资源...');
        const res = await fetch('/api/login', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ towerUrl, username, password })
        });
        const data = await res.json().catch(()=>({}));
        if(!res.ok){
          setMsg(data.message || '登录失败', false);
          setLoginHint('请检查地址或账号密码后重试。');
          return;
        }
        const clouds = Array.isArray(data.clouds) ? data.clouds : [];
        if(clouds.length===0){
          fillSelect('cloudId', []);
          fillSelect('namespace', [{value:'default', label:'default'}]);
          setMsg('登录成功，但当前用户无可用 Cloudmap 资源池', false);
          setLoginHint('当前账号没有资源池可见权限。');
          return;
        }
        fillSelect('cloudId', clouds.map(c=>({value:c.id, label:c.name + ' (' + c.id + ')'})));
        await loadNamespaces();
        setMsg('登录成功，已加载可用 Cloudmap 与项目', true);
        setLoginHint('可以直接进入下方镜像上传区域。');
      }catch(err){
        setMsg(err && err.message ? err.message : '登录失败', false);
        setLoginHint('登录过程出现异常，请稍后重试。');
      }
    }
    document.addEventListener('DOMContentLoaded', ()=>{
      fillSelect('cloudId', []);
      fillSelect('namespace', [{value:'default', label:'default'}]);
      document.getElementById('cloudId').addEventListener('change', async ()=>{
        try { await loadNamespaces(); } catch (e) { setMsg(e.message || '加载项目失败', false); }
      });
    });
    async function submit(){
      const file = document.getElementById('file').files[0];
      if(!file){ setMsg('请先选择文件', false); return; }
      const fd = new FormData();
      fd.append('towerUrl', document.getElementById('towerUrl').value.trim());
      fd.append('towerToken', '');
      fd.append('cloudId', document.getElementById('cloudId').value.trim());
      fd.append('namespace', document.getElementById('namespace').value.trim() || 'default');
      const dn1 = document.getElementById('displayName').value.trim();
      fd.append('displayName', dn1);
      fd.append('imageType', document.getElementById('imageType').value.trim());
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST','/api/upload-direct');
      const bar = document.getElementById('bar');
      const ptxt = document.getElementById('ptxt');
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
        const text = xhr.responseText || '完成';
        const ok = xhr.status>=200 && xhr.status<300;
        setMsg(text, ok);
        setUploadHint(ok ? '文件已直传到底座，请在 Tower 镜像列表查看导入进度。' : '上传失败，请检查提示信息。');
      };
      xhr.onerror = ()=>{
        setMsg('连接服务器失败 (请查看工具运行窗口的日志)', false);
        setUploadHint('网络连接失败或服务未启动。');
      };
      setMsg('开始上传...');
      setUploadHint('正在上传到本机工具；完成后将直传底座，请勿关闭窗口...');
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
	var towerSessionToken string
	mux := http.NewServeMux()
	indexPage := strings.Replace(indexHTML, "BUILD_ID_PLACEHOLDER", uploaderBuildID, 1)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		w.Header().Set("X-Uploader-Build-Id", uploaderBuildID)
		io.WriteString(w, indexPage)
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

		towerURL := normalizeTowerURL(r.FormValue("towerUrl"))
		towerToken := r.FormValue("towerToken")
		cloudID := strings.TrimSpace(r.FormValue("cloudId"))
		ns := strings.TrimSpace(r.FormValue("namespace"))
		if ns == "" {
			ns = "default"
		}
		display := r.FormValue("displayName")
		imageType := strings.ToLower(r.FormValue("imageType"))
		if strings.TrimSpace(towerToken) == "" {
			towerToken = towerSessionToken
		}
		if towerURL == "" || towerToken == "" || cloudID == "" {
			w.WriteHeader(400)
			io.WriteString(w, "缺少参数：towerUrl/towerToken/cloudId")
			return
		}
		
		file, header, err := r.FormFile("file")
		if err != nil {
			fmt.Println("未找到文件")
			w.WriteHeader(400)
			io.WriteString(w, "缺少文件")
			return
		}
		defer file.Close()

		fmt.Printf("直传底座: cloud=%s, 项目=%s, 镜像=%s, 类型=%s, 文件=%s (%d bytes)\n", cloudID, ns, display, imageType, header.Filename, header.Size)
		if err := uploadDirectToHarvesterViaTower(towerURL, towerToken, cloudID, ns, display, imageType, file, header); err != nil {
			fmt.Printf("直传失败: %v\n", err)
			w.WriteHeader(500)
			io.WriteString(w, "上传失败: "+err.Error())
			return
		}
		fmt.Println("上传完成（文件已直传到底座）")
		io.WriteString(w, "上传成功。文件已直传到底座，请在 Tower 镜像列表查看导入进度。")
	})
	mux.HandleFunc("/api/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			io.WriteString(w, "Method Not Allowed")
			return
		}
		var reqBody struct {
			TowerURL string `json:"towerUrl"`
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			w.WriteHeader(400)
			io.WriteString(w, `{"message":"请求体格式错误"}`)
			return
		}
		token, err := loginTower(reqBody.TowerURL, reqBody.Username, reqBody.Password)
		if err != nil {
			w.WriteHeader(401)
			resp, _ := json.Marshal(map[string]any{"message": err.Error()})
			io.WriteString(w, string(resp))
			return
		}
		cfg := Config{
			TowerURL:   normalizeTowerURL(reqBody.TowerURL),
			TowerToken: token,
		}
		clouds, err := fetchHarvesterClouds(cfg)
		if err != nil {
			w.WriteHeader(500)
			resp, _ := json.Marshal(map[string]any{"message": "登录成功，但拉取云平台失败: " + err.Error()})
			io.WriteString(w, string(resp))
			return
		}
		towerSessionToken = token
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		resp, _ := json.Marshal(map[string]any{
			"message": "登录成功",
			"clouds":  func() []Cloud { if clouds == nil { return []Cloud{} }; return clouds }(),
		})
		io.WriteString(w, string(resp))
	})
	mux.HandleFunc("/api/namespaces", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			io.WriteString(w, "Method Not Allowed")
			return
		}
		var reqBody struct {
			TowerURL string `json:"towerUrl"`
			CloudID  string `json:"cloudId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			w.WriteHeader(400)
			io.WriteString(w, `{"message":"请求体格式错误"}`)
			return
		}
		if strings.TrimSpace(towerSessionToken) == "" {
			w.WriteHeader(401)
			io.WriteString(w, `{"message":"请先登录"}`)
			return
		}
		list, err := fetchCloudNamespaces(reqBody.TowerURL, towerSessionToken, reqBody.CloudID)
		if err != nil {
			w.WriteHeader(500)
			resp, _ := json.Marshal(map[string]any{"message": err.Error()})
			io.WriteString(w, string(resp))
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		resp, _ := json.Marshal(map[string]any{"namespaces": list})
		io.WriteString(w, string(resp))
	})
	const guiAddr = "127.0.0.1:8787"
	ln, err := net.Listen("tcp", guiAddr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n错误: 无法监听 %s（%v）\n", guiAddr, err)
		fmt.Fprintln(os.Stderr, "8787 端口通常被旧版 ImageUploader 占用。请在任务管理器中结束所有 ImageUploader 进程后，再运行本程序。")
		fmt.Fprintln(os.Stderr, "若从微信/下载目录运行过旧 exe，也请一并结束。")
		os.Exit(1)
	}
	go func() {
		if serveErr := http.Serve(ln, mux); serveErr != nil {
			fmt.Fprintf(os.Stderr, "图形界面服务异常退出: %v\n", serveErr)
			os.Exit(1)
		}
	}()
	fmt.Printf("镜像上传模式: 直传底座 (%s)\n", uploaderBuildID)
	fmt.Printf("图形界面已启动: http://%s/\n", guiAddr)
	exec.Command("rundll32", "url.dll,FileProtocolHandler", "http://"+guiAddr+"/").Start()
	select {}
}
