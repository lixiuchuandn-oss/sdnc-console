
import re
import os

file_path = r'd:\ComputeTower\Compute.Tower\backend\src\routes\clouds.harvester.ts'

if not os.path.exists(file_path):
    print(f"File not found: {file_path}")
    exit(1)

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add next to handler args
# Pattern: async (req: any, res: Response) =>
# This is safe because existing ones with next would match a different pattern or we can be specific.
# Existing with next: async (req: any, res: Response, next: any) =>
# So we only target the ones without next.
content = re.sub(r'async \(req: any, res: Response\) =>', r'async (req: any, res: Response, next: any) =>', content)

# 2. Add next to ensureProvider call
# Pattern: ensureProvider(cloud, 'harvester', res, 'STRING')
# We want to avoid double adding next.
# We match the function call ending with 'STRING').
# Regex explanation:
# ensureProvider\(  - literal start
# cloud, 'harvester', res, - literal args
# '.*?' - string argument (non-greedy)
# \) - closing parenthesis
# We check if it is followed by nothing that looks like , next
def replace_ensure(match):
    text = match.group(0)
    # Check if next is already the last argument
    # The regex matches up to the closing parenthesis of the string arg? 
    # No, the regex above matches the whole call ending with )
    
    # Let's verify the match.
    # The regex should be: ensureProvider\(cloud, 'harvester', res, '.*?'\)
    # If the original code is: ensureProvider(..., 'msg', next), then the regex won't match if we anchor to ) immediately after string.
    # But if there are spaces? 'msg' )
    
    return text.replace(')', ', next)')

# The regex matches: ensureProvider(cloud, 'harvester', res, 'ANYTHING')
# It will NOT match ensureProvider(..., 'msg', next) because there is ", next" between 'msg' and )
content = re.sub(r"ensureProvider\(cloud, 'harvester', res, '.*?'\)", replace_ensure, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully patched clouds.harvester.ts")
