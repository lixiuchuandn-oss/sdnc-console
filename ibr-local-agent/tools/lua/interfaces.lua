#!/usr/bin/env lua
local json = require("cjson")
-- 显式带上 /rhos/lib，与 vrctl-agent.service 一致，避免非 agent 环境找不到 libclish
CLISH_CMD="env LD_LIBRARY_PATH=/rhos/lib /rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view"

function execute_command(cmd)
    local handle = io.popen(cmd)
    local result = handle:read("*a")
    handle:close()
    if result == "" then
        result = nil
    end
    return result
end
local meta = {
    __call = function(self, op, cur_table, new_table)
        if op == "add" then
            if cur_table ~= nil then
                self.add_interface_all(cur_table)   
            end        
        elseif op == "update" then
            self.update_interface_all(cur_table, new_table)
        elseif op == "del" then
            self.del_interface_all(cur_table)
        elseif op == "clear_all_acl" then
            self.clear_all_interface_acl(cur_table)
        end
    end
}

interfaces = {}

interfaces.list = { "interfaces_BondEthernet",
    "subinterfaces_BondEthernet",
    "interfaces_TapEthernet",
    "subinterfaces_TapEthernet",
    "interfaces_memif",
    "subinterfaces_memif",
    "interfaces_GigabitEthernet",
    "subinterfaces_GigabitEthernet",
    "interfaces_lo",
    "interfaces_Tunnel",
    "subinterfaces_Tunnel" }


function interfaces.add_interface_all(cur_table)
    for _, v in pairs(interfaces.list) do
        if cur_table[v] then
            for _, v2 in pairs(cur_table[v]) do
                interfaces.add_interface_part(v2)
            end
        end
    end
end

function interfaces.del_interface_all(cur_table)
    for i= #interfaces.list, 1, -1 do
        if cur_table[interfaces.list[i]] then
            for _, v2 in pairs(cur_table[interfaces.list[i]]) do
                interfaces.del_interface_part(v2)
            end
        end
    end
end

function interfaces.update_interface_all(cur_table, new_table)
    for _, v in pairs(interfaces.list) do
        if new_table[v] and not cur_table[v] then
            for _, v2 in pairs(new_table[v]) do
                interfaces.add_interface_part(v2)
            end
        end
        if cur_table[v] and new_table[v] then
            -- add update interface
            for _, v2 in pairs(new_table[v]) do
                local found = false
                for _, v3 in pairs(cur_table[v]) do
                    if v2.name == v3.name then
                        found = true
                        interfaces.compare_interface_part(v3, v2)
                        break
                    end
                end
                if not found then
                    interfaces.add_interface_part(v2)
                end
            end
            -- del interface
            for _, v2 in pairs(cur_table[v]) do
                local found = false
                for _, v3 in pairs(new_table[v]) do
                    if v2.name == v3.name then
                        found = true
                        break
                    end
                end
                if not found then
                    interfaces.del_interface_part(v2)
                end
            end
        end
    end
    for i= #interfaces.list, 1, -1 do
        if cur_table[interfaces.list[i]] and not new_table[interfaces.list[i]] then
            for _, v2 in pairs(cur_table[interfaces.list[i]]) do
                interfaces.del_interface_part(v2)
            end
        end
    end
end

-- 将空串/空白视为未配置，便于按 VR2 意图清掉口上残留地址
function interfaces.normalize_addr(addr)
    if addr == nil then
        return nil
    end
    if type(addr) ~= "string" then
        return addr
    end
    local trimmed = addr:match("^%s*(.-)%s*$")
    if trimmed == nil or trimmed == "" then
        return nil
    end
    return trimmed
end

-- VR2 口名含空格（GigabitEthernet 0/7/0），tap-inject 左侧无空格
function interfaces.resolve_vswif(interface_name)
    if interface_name == nil then
        return nil
    end
    local key = string.gsub(interface_name, "%s+", "")
    local cmd = string.format(
        "vctl show tap-inject | awk -v n='%s' '{k=$1; gsub(/[ \\t]+/,\"\",k); if (k==n) { print $3; exit }}'",
        key
    )
    local out = execute_command(cmd)
    if not out then
        return nil
    end
    return out:match("^%s*(%S+)")
end

function interfaces.list_live_addrs(interface_name, family)
    local addrs = {}
    local vsw = interfaces.resolve_vswif(interface_name)
    if not vsw then
        return addrs
    end
    local cmd
    if family == "6" then
        cmd = string.format("ip -6 -o addr show dev '%s' scope global 2>/dev/null | awk '{print $4}'", vsw)
    else
        cmd = string.format("ip -4 -o addr show dev '%s' 2>/dev/null | awk '{print $4}'", vsw)
    end
    local out = execute_command(cmd)
    if not out then
        return addrs
    end
    for line in string.gmatch(out, "[^\r\n]+") do
        local a = line:match("^%s*(%S+)")
        if a then
            table.insert(addrs, a)
        end
    end
    return addrs
end

-- VRRP VIP 会出现在口的 live 地址里，同步 static 时不得当多余地址清掉
function interfaces.collect_vrrp_keep_addrs(vrrp)
    local keep = {}
    if not vrrp then
        return keep
    end
    for _, item in pairs(vrrp) do
        local list = item and item.virtual_ipaddress
        if type(list) == "table" then
            for _, raw in pairs(list) do
                if type(raw) == "string" then
                    for token in string.gmatch(raw, "%S+") do
                        keep[token] = true
                    end
                end
            end
        end
    end
    return keep
end

-- 以 VR2 意图为准：清掉口上多余地址，再写入期望地址（含期望为空时全清）
function interfaces.sync_interface_v4addr(interface_name, desired, keep)
    desired = interfaces.normalize_addr(desired)
    keep = keep or {}
    local live = interfaces.list_live_addrs(interface_name, "4")
    local has_desired = false
    for _, addr in ipairs(live) do
        if desired ~= nil and addr == desired then
            has_desired = true
        elseif not keep[addr] then
            interfaces.del_interface_v4addr(interface_name, addr)
        end
    end
    if desired and not has_desired then
        interfaces.add_interface_v4addr(interface_name, desired)
    end
end

function interfaces.sync_interface_v6addr(interface_name, desired, keep)
    desired = interfaces.normalize_addr(desired)
    keep = keep or {}
    local live = interfaces.list_live_addrs(interface_name, "6")
    local has_desired = false
    for _, addr in ipairs(live) do
        if desired ~= nil and addr == desired then
            has_desired = true
        elseif not keep[addr] then
            interfaces.del_interface_v6addr(interface_name, addr)
        end
    end
    if desired and not has_desired then
        interfaces.add_interface_v6addr(interface_name, desired)
    end
end

function interfaces.add_interface_part(interface_table)
    if interface_table == nil then
        return
    end
    if interface_table.name then
        interfaces.add_interface(interface_table.name)
    end
    if interface_table.vlan then
        interfaces.add_interface_vlan(interface_table.name, interface_table.vlan)
    end
    if interface_table.vrf then
        interfaces.add_interface_vrf(interface_table.name, interface_table.vrf)
        interfaces.set_interface_vrf_status(interface_table.name, "enable")
    end
    -- 无论 VR2 是否带地址字段，都按意图同步，避免本地初始化残留 IPv4/IPv6
    local keep = interfaces.collect_vrrp_keep_addrs(interface_table.vrrp)
    interfaces.sync_interface_v4addr(interface_table.name, interface_table.ipv4_static, keep)
    interfaces.sync_interface_v6addr(interface_table.name, interface_table.ipv6_static, keep)
    if interface_table.vrrp then
        for _, v in pairs(interface_table.vrrp) do
            interfaces.add_interface_vrrp_part(interface_table.name, v)
        end
    end
    if interface_table.acl then
        for _, v in pairs(interface_table.acl) do
            interfaces.add_interface_acl(interface_table.name, v)
        end
    end
    if interface_table.status then
        interfaces.set_interface_status(interface_table.name, interface_table.status)
    end
end

function interfaces.del_interface_part(interface_table)
    if interface_table == nil then
        return
    end
   if string.find(interface_table.name, "GigabitEthernet") and not string.find(interface_table.name, "%.") then
        interfaces.set_interface_status(interface_table.name, "down")
        if interface_table.vrrp then
            for _, v in pairs(interface_table.vrrp) do
                interfaces.del_interface_vrrp_part(interface_table.name, v)
            end
        end
        if interface_table.ipv4_static then
            interfaces.del_interface_v4addr(interface_table.name, interface_table.ipv4_static)
        end
        if interface_table.ipv6_static then
            interfaces.del_interface_v6addr(interface_table.name, interface_table.ipv6_static)
        end
        if interface_table.vrf then
            interfaces.del_interface_vrf(interface_table.name)
        end
        if interface_table.acl then
            for _, v in pairs(interface_table.acl) do
                interfaces.del_interface_acl(interface_table.name, v)
            end
        end
        if string.find(interface_table.name, "%.") then
            interfaces.del_interface(interface_table.name)
        end
    else
        interfaces.del_interface(interface_table.name)
    end
end
function interfaces.compare_interface_part(cur_table, new_table)
    if not cur_table then
        return 
    end
    if not new_table then
        return 
    end
    if cur_table.name ~= new_table.name then
        return
    end
    if cur_table.vlan ~= new_table.vlan then
        interfaces.del_interface_vlan(cur_table.name, cur_table.vlan)
        interfaces.add_interface_vlan(cur_table.name, new_table.vlan)
    end
    if cur_table.vrf ~= new_table.vrf then
        --命令行删除vrf时会将一些配置一起删除
        interfaces.del_interface_vrf(cur_table.name)
        interfaces.add_interface_vrf(cur_table.name, new_table.vrf)
        local keep = interfaces.collect_vrrp_keep_addrs(new_table.vrrp)
        interfaces.sync_interface_v4addr(cur_table.name, new_table.ipv4_static, keep)
        interfaces.sync_interface_v6addr(cur_table.name, new_table.ipv6_static, keep)
        if new_table.vrrp then  
            for _, v in pairs(new_table.vrrp) do
                interfaces.add_interface_vrrp_part(cur_table.name, v)
            end
        end
        interfaces.set_interface_status(cur_table.name, new_table.status)
    else
        -- 始终按 new（VR2 意图）同步地址，不依赖 bak 是否记录过本地残留地址
        local keep = interfaces.collect_vrrp_keep_addrs(new_table.vrrp)
        interfaces.sync_interface_v4addr(cur_table.name, new_table.ipv4_static, keep)
        interfaces.sync_interface_v6addr(cur_table.name, new_table.ipv6_static, keep)
        interfaces.compare_interface_vrrp_part(cur_table.name, cur_table.vrrp, new_table.vrrp)
        interfaces.compare_interface_acl_part(cur_table.name, cur_table.acl, new_table.acl)
        if cur_table.status ~= new_table.status then
            interfaces.set_interface_status(cur_table.name, new_table.status)
        end
    end
end


function interfaces.add_interface(interface_name)
    if interface_name == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s'", CLISH_CMD, interface_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface(interface_name)
    if interface_name == nil then
        return
    end
    local cmd = string.format("%s -c 'no interface %s'", CLISH_CMD, interface_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_vlan(interface_name, vlan_id)
    if interface_name == nil or vlan_id == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'dot1q %i'", CLISH_CMD, interface_name, vlan_id)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vlan(interface_name, vlan_id)
    if interface_name == nil or vlan_id == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no dot1q %i'", CLISH_CMD, interface_name, vlan_id)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_vrf(interface_name, vrf_name)
    if interface_name == nil or vrf_name == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrf %i'", CLISH_CMD, interface_name, vrf_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vrf(interface_name)
    if interface_name == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrf'", CLISH_CMD, interface_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.set_interface_vrf_status(interface_name, status)
    if interface_name == nil or status == nil then
        return
    end
    local cmd = ""
    if status == "enable" then
        cmd = string.format("%s -c 'interface %s' -c 'vrf enable'", CLISH_CMD, interface_name)
    else
        cmd = string.format("%s -c 'interface %s' -c 'no vrf enable'", CLISH_CMD, interface_name) 
    end
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_v4addr(interface_name, v4_addr)
    if interface_name == nil or v4_addr == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'ip address %s'", CLISH_CMD, interface_name, v4_addr)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_v4addr(interface_name, v4_addr)
    if interface_name == nil or v4_addr == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no ip address %s'", CLISH_CMD, interface_name, v4_addr)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_v6addr(interface_name, v6_addr)
    if interface_name == nil or v6_addr == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'ipv6 address %s'", CLISH_CMD, interface_name, v6_addr)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_v6addr(interface_name, v6_addr)
    if interface_name == nil or v6_addr == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no ipv6 address %s'", CLISH_CMD, interface_name, v6_addr)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.set_interface_status(interface_name, status)
    if interface_name == nil or status == nil then
        return
    end
    if status == "down" then
        status = "shutdown"
    else
        status = "no shutdown"
    end
    local cmd = string.format("%s -c 'interface %s' -c '%s'", CLISH_CMD, interface_name, status)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

-- ACL配置相关函数
function interfaces.add_interface_acl(interface_name, acl_config)
    if not interface_name or not acl_config or not acl_config.acl_id or not acl_config.direction then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'acl %d %s'", CLISH_CMD, interface_name, acl_config.acl_id, acl_config.direction)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_acl(interface_name, acl_config)
    if not interface_name or not acl_config or not acl_config.acl_id or not acl_config.direction then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no acl %d %s'", CLISH_CMD, interface_name, acl_config.acl_id, acl_config.direction)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

-- 移除接口上所有ACL配置
function interfaces.clear_interface_acl(interface_name, acl_list)
    if not interface_name then
        return
    end
    
    if acl_list then
        -- 根据具体的ACL ID和方向移除ACL
        for _, acl in pairs(acl_list) do
            if acl.acl_id and acl.direction then
                local cmd = string.format("%s -c 'interface %s' -c 'no acl %d %s'", CLISH_CMD, interface_name, acl.acl_id, acl.direction)
                print(cmd)
                execute_command(cmd)
            end
        end
    end
end

-- 移除所有接口上的所有ACL配置
function interfaces.clear_all_interface_acl(cur_table)
    if not cur_table then
        return
    end
    
    for _, v in pairs(interfaces.list) do
        if cur_table[v] then
            for _, v2 in pairs(cur_table[v]) do
                if v2.name and v2.acl then
                    interfaces.clear_interface_acl(v2.name, v2.acl)
                end
            end
        end
    end
end

function interfaces.compare_interface_acl_part(interface_name, cur_table, new_table)
    if not interface_name then
        return
    end
    
    -- 只有新表，添加所有ACL配置
    if not cur_table and new_table then
        for _, v in pairs(new_table) do
            interfaces.add_interface_acl(interface_name, v)
        end
        return
    end
    
    -- 只有旧表，删除所有ACL配置
    if cur_table and not new_table then
        for _, v in pairs(cur_table) do
            interfaces.del_interface_acl(interface_name, v)
        end
        return
    end
    
    -- 新旧表都存在，比较并更新
    if cur_table and new_table then
        -- 1. 删除不再需要的ACL配置
        for _, cur_acl in pairs(cur_table) do
            local found = false
            for _, new_acl in pairs(new_table) do
                if cur_acl.acl_id == new_acl.acl_id and cur_acl.direction == new_acl.direction then
                    found = true
                    break
                end
            end
            if not found then
                interfaces.del_interface_acl(interface_name, cur_acl)
            end
        end
        
        -- 2. 添加新的或更新的ACL配置
        for _, new_acl in pairs(new_table) do
            local found = false
            for _, cur_acl in pairs(cur_table) do
                if cur_acl.acl_id == new_acl.acl_id and cur_acl.direction == new_acl.direction then
                    found = true
                    -- 先删除旧的ACL配置
                    interfaces.del_interface_acl(interface_name, cur_acl)
                    break
                end
            end
            -- 添加新的ACL配置
            interfaces.add_interface_acl(interface_name, new_acl)
        end
    end
end

--[[
"vrrp":[
        {
            "vrid":1, #取值范围[1,232]
            "advert_interval":30, #取值范围[1,256]
            "preempt":true, #默认抢占；false 时下发 vrrp vrid N disable-preempt
            "auth_pass":"1235456",  #string
            "priority":200,#取值范围[1,255],越大优先级越高
            "unicast_peer":"10.16.160.125",  # HA 单播对端
            "unicast_source":"10.16.160.124",  # HA 单播本端源
            "virtual_ipaddress":[
                "12.12.12.1/16",
                "1.1.1.1/16 1.1.1.16/16"
            ]
        }
    ],
]]
function interfaces.add_interface_vrrp_part(interface_name, cur_table)
    if not cur_table then
        return
    end
    if not cur_table.vrid then
        return
    end
    if cur_table.advert_interval then
        interfaces.add_interface_vrrp_advert_interval(interface_name, cur_table.vrid, cur_table.advert_interval)
    end
    if cur_table.auth_pass then
        interfaces.add_interface_vrrp_auth_pass(interface_name, cur_table.vrid, cur_table.auth_pass)
    end
    if cur_table.priority then
        interfaces.add_interface_vrrp_priority(interface_name, cur_table.vrid, cur_table.priority)
    end
    -- 现网 HA 单播宣告：vrrp vrid N unicast-peer / unicast-source
    if cur_table.unicast_peer then
        interfaces.add_interface_vrrp_unicast_peer(interface_name, cur_table.vrid, cur_table.unicast_peer)
    end
    if cur_table.unicast_source then
        interfaces.add_interface_vrrp_unicast_source(interface_name, cur_table.vrid, cur_table.unicast_source)
    end
    if cur_table.virtual_ipaddress then
        for _, v in pairs(cur_table.virtual_ipaddress) do
            interfaces.add_interface_vrrp_virtual_ipaddress(interface_name, cur_table.vrid, v)
        end
    end
    -- 抢占须在实例已创建后下发；字段缺省=设备默认抢占，不写 CLI
    if cur_table.preempt == false or cur_table.preempt == true then
        interfaces.apply_interface_vrrp_preempt(interface_name, cur_table.vrid, cur_table.preempt)
    end
end

function interfaces.del_interface_vrrp_part(interface_name, cur_table)
    if not cur_table then
        return
    end
    if not cur_table.vrid then
        return
    end
    if cur_table.advert_interval then
        interfaces.del_interface_vrrp_advert_interval(interface_name, cur_table.vrid, cur_table.advert_interval)
    end
    if cur_table.auth_pass then
        interfaces.del_interface_vrrp_auth_pass(interface_name, cur_table.vrid, cur_table.auth_pass)
    end
    if cur_table.priority then
        interfaces.del_interface_vrrp_priority(interface_name, cur_table.vrid, cur_table.priority)
    end
    if cur_table.unicast_peer then
        interfaces.del_interface_vrrp_unicast_peer(interface_name, cur_table.vrid, cur_table.unicast_peer)
    end
    if cur_table.unicast_source then
        interfaces.del_interface_vrrp_unicast_source(interface_name, cur_table.vrid, cur_table.unicast_source)
    end
    if cur_table.virtual_ipaddress then
        for _, v in pairs(cur_table.virtual_ipaddress) do
            interfaces.del_interface_vrrp_virtual_ipaddress(interface_name, cur_table.vrid, v)
        end
    end
    if cur_table.preempt == false then
        interfaces.del_interface_vrrp_disable_preempt(interface_name, cur_table.vrid)
    end
end

function interfaces.compare_interface_vrrp_part(interface_name, cur_table, new_table)
    if not interface_name then
        return
    end
    if not cur_table and new_table then
        for _, v in pairs(new_table) do
            interfaces.add_interface_vrrp_part(interface_name, v)
        end
    end
    if cur_table and not new_table then
        for _, v in pairs(cur_table) do
            interfaces.del_interface_vrrp_part(interface_name, v)
        end
    end
    -- 更新vrrp
    if cur_table and new_table then
        -- 增加更新vrrp内部配置
        for _, v in pairs(new_table) do
            local found = false
            for _, v2 in pairs(cur_table) do
                if v.vrid == v2.vrid then
                    found = true
                    if v.advert_interval ~= v2.advert_interval then
                        interfaces.del_interface_vrrp_advert_interval(interface_name, v.vrid, v2.advert_interval)
                        interfaces.add_interface_vrrp_advert_interval(interface_name, v.vrid, v.advert_interval)
                    end
                    if v.auth_pass ~= v2.auth_pass then
                        interfaces.del_interface_vrrp_auth_pass(interface_name, v.vrid, v2.auth_pass)
                        interfaces.add_interface_vrrp_auth_pass(interface_name, v.vrid, v.auth_pass)
                    end
                    if v.priority ~= v2.priority then
                        interfaces.del_interface_vrrp_priority(interface_name, v.vrid, v2.priority)
                        interfaces.add_interface_vrrp_priority(interface_name, v.vrid, v.priority)
                    end
                    if v.unicast_peer ~= v2.unicast_peer then
                        if v2.unicast_peer then
                            interfaces.del_interface_vrrp_unicast_peer(interface_name, v.vrid, v2.unicast_peer)
                        end
                        if v.unicast_peer then
                            interfaces.add_interface_vrrp_unicast_peer(interface_name, v.vrid, v.unicast_peer)
                        end
                    end
                    if v.unicast_source ~= v2.unicast_source then
                        if v2.unicast_source then
                            interfaces.del_interface_vrrp_unicast_source(interface_name, v.vrid, v2.unicast_source)
                        end
                        if v.unicast_source then
                            interfaces.add_interface_vrrp_unicast_source(interface_name, v.vrid, v.unicast_source)
                        end
                    end
                    if (v.preempt == false) ~= (v2.preempt == false) then
                        interfaces.apply_interface_vrrp_preempt(interface_name, v.vrid, v.preempt)
                    end
                    interfaces.compare_interface_vrrp_virtual_ipaddress(interface_name, v.vrid, v2.virtual_ipaddress, v.virtual_ipaddress)
                    break
                end
            end
            if not found then
                interfaces.add_interface_vrrp_part(interface_name, v)
            end
        end
        -- 删除vrrp内部配置
        for _, v in pairs(cur_table) do
            local found = false
            for _, v2 in pairs(new_table) do
                if v.vrid == v2.vrid then
                    found = true
                    break
                end
            end
            if not found then
                interfaces.del_interface_vrrp_part(interface_name, v)
            end
        end
    end
end

function interfaces.compare_interface_vrrp_virtual_ipaddress(interface_name, vrid, cur_table, new_table)
    if not interface_name then
        return
    end
    if not cur_table and new_table then
        for _, v in pairs(new_table) do
            interfaces.add_interface_vrrp_virtual_ipaddress(interface_name, vrid, v)
        end
    end
    if cur_table and not new_table then
        for _, v in pairs(cur_table) do
            interfaces.del_interface_vrrp_virtual_ipaddress(interface_name, vrid, v)
        end
    end
    if cur_table and new_table then
        --删除虚拟ip
        for _, v in pairs(cur_table) do
            local found = false
            for _, v2 in pairs(new_table) do
                if v == v2 then
                    found = true
                    break
                end
            end
            if not found then
                interfaces.del_interface_vrrp_virtual_ipaddress(interface_name, vrid, v)
            end
        end
        -- 增加虚拟ip
        for _, v in pairs(new_table) do
            local found = false
            for _, v2 in pairs(cur_table) do
                if v == v2 then
                    found = true
                    break
                end
            end
            if not found then
                interfaces.add_interface_vrrp_virtual_ipaddress(interface_name, vrid, v)
            end
        end
    end
end

function interfaces.add_interface_vrrp_advert_interval(interface_name, vrid, advert_interval)
    if interface_name == nil or vrid == nil or advert_interval == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i advert_int %i'", CLISH_CMD, interface_name, vrid, advert_interval)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vrrp_advert_interval(interface_name, vrid, advert_interval)
    if interface_name == nil or vrid == nil or advert_interval == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i advert_int %i'", CLISH_CMD, interface_name, vrid, advert_interval)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

-- 设备 CLI：vrrp vrid N disable-preempt / no vrrp vrid N disable-preempt（默认抢占）
function interfaces.apply_interface_vrrp_preempt(interface_name, vrid, preempt)
    if preempt == false then
        return interfaces.add_interface_vrrp_disable_preempt(interface_name, vrid)
    end
    return interfaces.del_interface_vrrp_disable_preempt(interface_name, vrid)
end

function interfaces.add_interface_vrrp_disable_preempt(interface_name, vrid)
    if interface_name == nil or vrid == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i disable-preempt'", CLISH_CMD, interface_name, vrid)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vrrp_disable_preempt(interface_name, vrid)
    if interface_name == nil or vrid == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i disable-preempt'", CLISH_CMD, interface_name, vrid)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_vrrp_auth_pass(interface_name, vrid, auth_pass)
    if interface_name == nil or vrid == nil or auth_pass == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i auth_pass %s'", CLISH_CMD, interface_name, vrid, auth_pass)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vrrp_auth_pass(interface_name, vrid, auth_pass)
    if interface_name == nil or vrid == nil or auth_pass == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i auth_pass %s'", CLISH_CMD, interface_name, vrid, auth_pass)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_vrrp_priority(interface_name, vrid, priority)
    if interface_name == nil or vrid == nil or priority == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i priority %i'", CLISH_CMD, interface_name, vrid, priority)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vrrp_priority(interface_name, vrid, priority)
    if interface_name == nil or vrid == nil or priority == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i priority %i'", CLISH_CMD, interface_name, vrid, priority)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.add_interface_vrrp_unicast_peer(interface_name, vrid, unicast_peer)
    if interface_name == nil or vrid == nil or unicast_peer == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i unicast-peer %s'", CLISH_CMD, interface_name, vrid, unicast_peer)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function interfaces.del_interface_vrrp_unicast_peer(interface_name, vrid, unicast_peer)
    if interface_name == nil or vrid == nil or unicast_peer == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i unicast-peer %s'", CLISH_CMD, interface_name, vrid, unicast_peer)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function interfaces.add_interface_vrrp_unicast_source(interface_name, vrid, unicast_source)
    if interface_name == nil or vrid == nil or unicast_source == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i unicast-source %s'", CLISH_CMD, interface_name, vrid, unicast_source)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function interfaces.del_interface_vrrp_unicast_source(interface_name, vrid, unicast_source)
    if interface_name == nil or vrid == nil or unicast_source == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i unicast-source %s'", CLISH_CMD, interface_name, vrid, unicast_source)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function interfaces.add_interface_vrrp_virtual_ipaddress(interface_name, vrid, virtual_ipaddress)
    if interface_name == nil or vrid == nil or virtual_ipaddress == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'vrrp vrid %i virtual_ipaddress %s'", CLISH_CMD, interface_name, vrid, virtual_ipaddress)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function interfaces.del_interface_vrrp_virtual_ipaddress(interface_name, vrid, virtual_ipaddress)
    if interface_name == nil or vrid == nil or virtual_ipaddress == nil then
        return
    end
    local cmd = string.format("%s -c 'interface %s' -c 'no vrrp vrid %i virtual_ipaddress %s'", CLISH_CMD, interface_name, vrid, virtual_ipaddress)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

setmetatable(interfaces, meta)

return interfaces
