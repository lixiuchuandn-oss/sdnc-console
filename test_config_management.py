"""
测试 ConfigMap 和 Secret 管理功能
"""
from playwright.sync_api import sync_playwright
import time

# 配置
FRONTEND_URL = "http://localhost:5000"
TEST_CLOUD_NAME = "harvester-test"  # 需要修改为实际的云名称

def test_config_management():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()
        
        try:
            # 1. 导航到应用
            print("正在导航到应用...")
            page.goto(FRONTEND_URL)
            page.wait_for_load_state('networkidle')
            
            # 截图检查初始状态
            page.screenshot(path='/tmp/01_initial.png')
            print("已保存截图: 01_initial.png")
            
            # 2. 检查是否需要登录
            current_url = page.url
            print(f"当前URL: {current_url}")
            
            # 如果在登录页面，执行登录
            if '/login' in current_url or page.locator('input[placeholder*="用户名"]').count() > 0:
                print("检测到登录页面，正在登录...")
                page.fill('input[placeholder*="用户名"]', 'admin')
                page.fill('input[placeholder*="密码"]', 'admin123')
                page.click('button:has-text("登录")')
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                page.screenshot(path='/tmp/02_after_login.png')
                print("已保存截图: 02_after_login.png")
            
            # 3. 查找并点击云资源菜单
            print("查找云资源菜单...")
            
            # 尝试找到侧边栏中的云资源或类似菜单
            # 先截图看看当前页面结构
            page.screenshot(path='/tmp/03_dashboard.png')
            
            # 获取页面内容分析
            content = page.content()
            
            # 尝试找云资源相关链接
            cloud_links = page.locator('a:has-text("云"), a:has-text("Cloud"), [class*="menu"]:has-text("云")').all()
            print(f"找到 {len(cloud_links)} 个云相关链接")
            
            # 尝试导航到云资源列表
            # 查找 Harvester 相关的云
            harvester_link = page.locator('text=/harvester/i').first
            if harvester_link.count() > 0:
                print("找到 Harvester 链接，点击...")
                harvester_link.click()
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                page.screenshot(path='/tmp/04_harvester.png')
            
            # 4. 查找容器/配置管理 Tab
            print("查找配置管理...")
            
            # 查找 Tab 或菜单项
            config_tab = page.locator('text=/配置管理|ConfigMap|Config/i').first
            if config_tab.count() > 0:
                print("找到配置管理 Tab，点击...")
                config_tab.click()
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                page.screenshot(path='/tmp/05_config_section.png')
            
            # 5. 测试 ConfigMap 创建按钮
            print("测试 ConfigMap 创建按钮...")
            create_cm_btn = page.locator('button:has-text("创建 ConfigMap")')
            if create_cm_btn.count() > 0:
                print("找到创建 ConfigMap 按钮")
                create_cm_btn.click()
                time.sleep(1)
                page.screenshot(path='/tmp/06_configmap_modal.png')
                
                # 填写表单
                page.fill('input[placeholder*="my-config"]', 'test-configmap')
                page.select_option('select', index=0)  # 选择第一个命名空间
                
                # 添加数据
                add_data_btn = page.locator('button:has-text("添加数据项")')
                if add_data_btn.count() > 0:
                    add_data_btn.click()
                    time.sleep(0.5)
                    page.fill('input[placeholder*="config.yaml"]', 'app.conf')
                    page.fill('textarea', 'server:\n  port: 8080')
                
                page.screenshot(path='/tmp/07_configmap_filled.png')
                
                # 取消而不是真的创建
                page.click('button:has-text("取消")')
                print("ConfigMap 表单测试完成")
            
            # 6. 测试 Secret Tab
            print("切换到 Secret Tab...")
            secret_tab = page.locator('text=/Secret|密钥/i').first
            if secret_tab.count() > 0:
                secret_tab.click()
                page.wait_for_load_state('networkidle')
                time.sleep(1)
                page.screenshot(path='/tmp/08_secret_tab.png')
            
            # 7. 测试 Secret 创建按钮
            print("测试 Secret 创建按钮...")
            create_secret_btn = page.locator('button:has-text("创建 Secret")')
            if create_secret_btn.count() > 0:
                print("找到创建 Secret 按钮")
                create_secret_btn.click()
                time.sleep(1)
                page.screenshot(path='/tmp/09_secret_modal.png')
                
                # 填写表单
                page.fill('input[placeholder*="my-secret"]', 'test-secret')
                
                # 选择类型
                type_select = page.locator('label:has-text("类型")').locator('..').locator('select')
                if type_select.count() > 0:
                    type_select.select_option(label='Opaque (通用密钥)')
                
                # 添加数据
                add_secret_data_btn = page.locator('button:has-text("添加数据项")')
                if add_secret_data_btn.count() > 0:
                    add_secret_data_btn.click()
                    time.sleep(0.5)
                    
                    # 填写键
                    key_input = page.locator('input[placeholder*="password"]').first
                    if key_input.count() > 0:
                        key_input.fill('db-password')
                    
                    # 填写值（密码框）
                    password_input = page.locator('input[type="password"], input.ant-input-password').first
                    if password_input.count() > 0:
                        password_input.fill('mysecretpassword123')
                
                page.screenshot(path='/tmp/10_secret_filled.png')
                
                # 取消
                page.click('button:has-text("取消")')
                print("Secret 表单测试完成")
            
            print("\n测试完成！请查看截图验证功能:")
            print("- /tmp/01_initial.png - 初始页面")
            print("- /tmp/02_after_login.png - 登录后")
            print("- /tmp/03_dashboard.png - 仪表盘")
            print("- /tmp/04_harvester.png - Harvester 页面")
            print("- /tmp/05_config_section.png - 配置管理区域")
            print("- /tmp/06_configmap_modal.png - ConfigMap 创建弹窗")
            print("- /tmp/07_configmap_filled.png - ConfigMap 表单填写")
            print("- /tmp/08_secret_tab.png - Secret Tab")
            print("- /tmp/09_secret_modal.png - Secret 创建弹窗")
            print("- /tmp/10_secret_filled.png - Secret 表单填写")
            
        except Exception as e:
            print(f"测试出错: {e}")
            page.screenshot(path='/tmp/error.png')
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    test_config_management()
