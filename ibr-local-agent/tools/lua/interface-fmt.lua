#!/usr/bin/env lua

local interfaces = {}
local current = nil

-- 辅助函数：解析一行末尾的统计数据 (例如 " rx packets 103")
local function parse_counter(text, counter_table)
    if not text or text == "" then return end
    
    local parts = {}
    for w in text:gmatch("%S+") do table.insert(parts, w) end
    
    -- 至少要有名称和数值 (parts >= 2)
    if #parts >= 2 then
        local val = table.remove(parts) -- 最后一个是数值
        local key = table.concat(parts, " ") -- 前面的是key (如 "rx packets")
        table.insert(counter_table, {k=key, v=val})
    end
end

for line in io.lines() do
    -- 跳过标题行 (包含 Name 和 Idx 的行)
    if not line:find("Name%s+Idx") then
        
        -- 尝试匹配接口定义行，并捕获这一行剩余的内容 (rest)
        -- 模式：Name(非空) Idx(数字) State(非空) MTU(非空) 剩余内容(.*)
        local name, idx, state, mtu, rest = line:match("^(%S+)%s+(%d+)%s+(%S+)%s+(%S+)(.*)")
        
        if name then
            -- 发现新接口
            if current then table.insert(interfaces, current) end
            
            current = {
                name = name,
                idx = tonumber(idx),
                state = state,
                mtu = mtu,
                counters = {}
            }
            
            -- 【修复点】检查这一行末尾是否有统计数据 (比如 rx packets)
            if rest and rest:match("%S") then
                parse_counter(rest, current.counters)
            end
            
        else
            -- 不是接口行，检查是否为缩进的统计行
            -- 只有当当前有接口上下文，且行首是空白时才处理
            if current and (line:sub(1,1) == " " or line:sub(1,1) == "\t") then
                parse_counter(line, current.counters)
            end
        end
    end
end

-- 插入最后一个接口
if current then table.insert(interfaces, current) end

-- 输出 JSON
print("[")
for i, iface in ipairs(interfaces) do
    io.write(string.format('  {\n    "name": "%s",\n    "idx": %d,\n    "state": "%s",\n    "mtu": "%s",\n    "counters": {', 
        iface.name, iface.idx, iface.state, iface.mtu))
    
    for j, cnt in ipairs(iface.counters) do
        -- 如果不是第一个元素，加逗号和换行
        if j > 1 then io.write(",") end
        io.write(string.format('\n      "%s": %s', cnt.k, cnt.v))
    end
    
    -- 如果有计数器，换行闭合；如果没有，直接闭合
    if #iface.counters > 0 then
        io.write("\n    }")
    else
        io.write("}") -- 空对象不换行，稍微美观一点
    end
    
    io.write("\n  }")
    if i < #interfaces then io.write(",") end
    io.write("\n")
end
print("]")
