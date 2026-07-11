#!/usr/bin/env lua
package.path = package.path .. ";/rhos/etc/agent/tools/lua/?.lua"
local json = require("cjson")
local cli = require("cli")
CLISH_CMD="/rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view"
-- 读取文件函数
function execute_command(cmd)
    local handle = io.popen(cmd)
    local result = handle:read("*a")
    handle:close()
    if result == "" then
        result = nil
    end
    return result
end
local function read_file(path)
    local file = io.open(path, "r")
    if not file then
        print("错误：无法打开文件 " .. path)
        return nil
    end
    local content = file:read("*all")
    file:close()
    return content
end
--cli.vrf("cmp_add", data1.vrf, data2.vrf)
--cli.ipv4_routes("cmp_del", data1.ipv4_routes,data2.ipv4_routes)
-- 处理解析后的数据
local function process_data(data1,data2)
    if data1 and data1.bgp then
        table.sort(data1.bgp, function(a, b)
            if not a.vrf and b.vrf then
                return true
            elseif a.vrf and not b.vrf then
                return false
            end
            return false
        end)
    end
    if data2 and data2.bgp then
        table.sort(data2.bgp, function(a, b)
            if not a.vrf and b.vrf then
                return true
            elseif a.vrf and not b.vrf then
                return false
            end
            return false
        end)
    end
    if data1 and not data2 then
        cli.vrf("add", data1.vrf)
        cli.interfaces("add", data1)
        cli.ipv4_routes("add", data1.ipv4_route)
        cli.ipv6_routes("add", data1.ipv6_route)
        cli.ip_prefix_list("add", data1.ip_prefix_list)
        cli.segment_routing("add", data1.segment_routing_srv6)
        cli.route_map("add", data1.route_map)
        cli.bgp("add", data1)
        cli.vrrp("add", data1.vrrp)
        cli.ipsec("add", data1.ipsec)
        cli.acl("add", data1.acl)
    end
    if data2 and data1 then
        cli.vrf("cmp_add", data1.vrf, data2.vrf)
        -- 先从所有接口上移除ACL配置，确保ACL修改时没有接口使用
        cli.interfaces("clear_all_acl", data1)
        cli.acl("cmp_add", data1.acl, data2.acl)
        cli.acl("cmp_del", data1.acl, data2.acl)
        cli.interfaces("update", data1, data2)
        cli.ipv4_routes("cmp_add", data1.ipv4_route, data2.ipv4_route)
        cli.ipv6_routes("cmp_add", data1.ipv6_route, data2.ipv6_route)
        cli.ip_prefix_list("cmp_add", data1.ip_prefix_list, data2.ip_prefix_list)
        cli.route_map("cmp_add", data1.route_map, data2.route_map)
        cli.bgp("update", data1, data2)
        cli.vrrp("cmp_add", data1.vrrp, data2.vrrp)
        cli.vrrp("cmp_del", data1.vrrp, data2.vrrp)
        cli.ipsec("cmp_add", data1.ipsec, data2.ipsec)
        cli.ipsec("cmp_del", data1.ipsec, data2.ipsec)
        cli.route_map("cmp_del", data1.route_map, data2.route_map)
        cli.ip_prefix_list("cmp_del", data1.ip_prefix_list, data2.ip_prefix_list)
        cli.ipv6_routes("cmp_del", data1.ipv6_route, data2.ipv6_route)
        cli.ipv4_routes("cmp_del", data1.ipv4_route, data2.ipv4_route)
        cli.vrf("cmp_del", data1.vrf, data2.vrf)
    end
    local cmd = string.format("%s -c 'do save'", CLISH_CMD)
    execute_command(cmd)
end
    
function main()
    -- 获取文件路径
    local file_path1 = arg[1]
    local file_path2 = arg[2]
    
    if file_path1 then
        content = read_file(file_path1)
    end
    if file_path2 then
        content1 = read_file(file_path2)
    end
    if content then
        data1 = json.decode(content)
    end
    if content1 then
        data2 = json.decode(content1)
    end
    process_data(data1,data2)
end

main()
