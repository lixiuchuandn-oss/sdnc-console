#!/usr/bin/env lua

local ipsec_conns = {}
local current_conn = nil
local current_net = nil

for line in io.lines() do
    -- 匹配 conn 行: conn498154b156b946529ecaf6a51d3da00e: #163432, ESTABLISHED, ...
    local conn_id = line:match("^conn([%w]+):")
    
    if conn_id then
        -- 发现新的conn，保存之前的conn
        if current_conn then
            -- 保存最后一个net到conn
            if current_net then
                current_conn.net = current_net
            end
            table.insert(ipsec_conns, current_conn)
        end
        
        -- 创建新的conn
        current_conn = {
            id = conn_id,
            net = nil
        }
        current_net = nil
    else
        -- 匹配 net 行: net498154b156b946529ecaf6a51d3da00e: #152, reqid 1, ...
        local net_id = line:match("^%s+net([%w]+):")
        
        if net_id and current_conn then
            -- 保存之前的net到conn（如果有）
            if current_net then
                current_conn.net = current_net
            end
            
            -- 创建新的net
            current_net = {
                in_bytes = 0,
                in_packets = 0,
                out_bytes = 0,
                out_packets = 0
            }
        elseif current_net then
            -- 匹配 in 行: in  c9e0b463, 0 bytes,    0 packets
            -- 处理可能的多个空格
            local in_bytes, in_packets = line:match("^%s+in%s+[%w]+,%s*(%d+)%s+bytes,%s*(%d+)%s+packets")
            if in_bytes and in_packets then
                current_net.in_bytes = tonumber(in_bytes)
                current_net.in_packets = tonumber(in_packets)
            end
            
            -- 匹配 out 行: out c1b7ab1f,      0 bytes,    0 packets
            -- 处理可能的多个空格
            local out_bytes, out_packets = line:match("^%s+out%s+[%w]+,%s*(%d+)%s+bytes,%s*(%d+)%s+packets")
            if out_bytes and out_packets then
                current_net.out_bytes = tonumber(out_bytes)
                current_net.out_packets = tonumber(out_packets)
            end
        end
    end
end

-- 保存最后一个conn
if current_conn then
    if current_net then
        current_conn.net = current_net
    end
    table.insert(ipsec_conns, current_conn)
end

-- 输出 JSON
print("[")
for i, conn in ipairs(ipsec_conns) do
    if conn.net then
        io.write(string.format('  {\n    "id": "%s",\n    "in": {\n      "bytes": %d,\n      "packets": %d\n    },\n    "out": {\n      "bytes": %d,\n      "packets": %d\n    }\n  }',
            conn.id,
            conn.net.in_bytes or 0,
            conn.net.in_packets or 0,
            conn.net.out_bytes or 0,
            conn.net.out_packets or 0))
    else
        -- 如果没有net数据，输出默认值
        io.write(string.format('  {\n    "id": "%s",\n    "in": {\n      "bytes": 0,\n      "packets": 0\n    },\n    "out": {\n      "bytes": 0,\n      "packets": 0\n    }\n  }',
            conn.id))
    end
    
    if i < #ipsec_conns then
        io.write(",")
    end
    io.write("\n")
end
print("]")
