"""
截图查看页面结构
"""
from playwright.sync_api import sync_playwright
import time

FRONTEND_URL = "http://localhost:5000"

def take_screenshots():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()
        
        try:
            print("正在导航到应用...")
            page.goto(FRONTEND_URL)
            page.wait_for_load_state('networkidle')
            time.sleep(2)
            
            # 截图
            page.screenshot(path='D:/screenshot_01.png')
            print("已保存截图: D:/screenshot_01.png")
            
            # 获取页面内容
            content = page.content()
            with open('D:/page_content.html', 'w', encoding='utf-8') as f:
                f.write(content)
            print("已保存页面内容: D:/page_content.html")
            
            # 打印当前 URL
            print(f"当前URL: {page.url}")
            
            # 查找所有按钮
            buttons = page.locator('button').all()
            print(f"\n找到 {len(buttons)} 个按钮:")
            for i, btn in enumerate(buttons[:10]):  # 只显示前10个
                try:
                    text = btn.inner_text()
                    print(f"  - 按钮 {i+1}: {text[:50]}")
                except:
                    pass
            
            # 查找所有输入框
            inputs = page.locator('input').all()
            print(f"\n找到 {len(inputs)} 个输入框:")
            for i, inp in enumerate(inputs[:10]):
                try:
                    placeholder = inp.get_attribute('placeholder')
                    input_type = inp.get_attribute('type')
                    print(f"  - 输入框 {i+1}: type={input_type}, placeholder={placeholder}")
                except:
                    pass
            
            # 查找所有链接
            links = page.locator('a').all()
            print(f"\n找到 {len(links)} 个链接:")
            for i, link in enumerate(links[:15]):
                try:
                    text = link.inner_text()
                    href = link.get_attribute('href')
                    print(f"  - 链接 {i+1}: {text[:30]} -> {href}")
                except:
                    pass
            
        except Exception as e:
            print(f"错误: {e}")
            page.screenshot(path='D:/screenshot_error.png')
        finally:
            browser.close()

if __name__ == "__main__":
    take_screenshots()
