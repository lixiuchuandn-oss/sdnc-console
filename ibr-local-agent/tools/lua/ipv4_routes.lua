#!/usr/bin/env lua
package.path = package.path .. ";/rhos/etc/agent/tools/lua/?.lua"
local json = require("cjson")
CLISH_CMD="/rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view"

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
            if cur_table and not new_table then
                for _, route_table in pairs(cur_table) do
                    self.add_ipv4_route(route_table)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table then
                print("----------")
                for _, new_route_table in pairs(new_table) do
                    self.add_ipv4_route(new_route_table)
                end
            end
            if cur_table and new_table then
                print("#######33")
                for _, new_route_table in pairs(new_table) do
                    local found = false
                    for _, cur_route_table in pairs(cur_table) do
                        if self.compare_ipv4_route(cur_route_table, new_route_table) then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.add_ipv4_route(new_route_table)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table and not new_table then
                for _, cur_route_table in pairs(cur_table) do
                    self.del_ipv4_route(cur_route_table)
                end
            end
            if cur_table and new_table then
                for _, cur_route_table in pairs(cur_table) do
                    local found = false
                    for _, new_route_table in pairs(new_table) do
                        if self.compare_ipv4_route(cur_route_table, new_route_table) then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.del_ipv4_route(cur_route_table)
                    end
                end
            end 
        elseif op == "del" then
            if cur_table and not new_table then
                for _, cur_route_table in pairs(cur_table) do
                    self.del_ipv4_route(cur_route_table)
                end
            end
        end
    end
}

local ipv4_routes = {}
function ipv4_routes.compare_ipv4_route(route_table1, route_table2)
    return route_table1.vrf == route_table2.vrf 
    and route_table1.destination == route_table2.destination
    and route_table1.blackhole == route_table2.blackhole
    and route_table1.via == route_table2.via 
    and route_table1.dev == route_table2.dev 
    and route_table1.priority == route_table2.priority
end

function ipv4_routes.add_ipv4_route(route_table)
    local vrf = route_table.vrf
    local destination = route_table.destination
    local blackhole = route_table.blackhole
    local via = route_table.via
    local dev = route_table.dev
    -- 注意：不可写成 if 内 local priority，否则块外 if priority 永远看不到（此前导致 priority 未拼进 CLI）
    local priority = nil
    if route_table.priority then
        priority = string.format("%i", route_table.priority)
    end
    local cmd = "ip route "

    if vrf then
        cmd = string.format("%s vrf %i", cmd, vrf)
    end
    if destination then
        cmd = string.format("%s %s", cmd, destination)
    end
    if blackhole == "enable" then
        cmd = string.format("%s blackhole", cmd)
    elseif via then
        cmd = string.format("%s via %s", cmd, via)
    end

    if dev then
        cmd = string.format("%s dev %s", cmd, dev)
    end
    if priority then
        cmd = string.format("%s priority %s", cmd, priority)
    end
    cmd = string.format("%s -c '%s'", CLISH_CMD, cmd)
    print(cmd)
    local result = execute_command(cmd)
    return result

end

function ipv4_routes.del_ipv4_route(route_table)
    local vrf = route_table.vrf
    local destination = route_table.destination
    local blackhole = route_table.blackhole
    local via = route_table.via
    local dev = route_table.dev
    local priority = nil
    if route_table.priority then
        priority = string.format("%i", route_table.priority)
    end
    local cmd = "no ip route "

    if vrf then
        cmd = string.format("%s vrf %i", cmd, vrf)
    end
    if destination then
        cmd = string.format("%s %s", cmd, destination)
    end
    if blackhole == "enable" then
        cmd = string.format("%s blackhole", cmd)
    elseif via then
        cmd = string.format("%s via %s", cmd, via)
    end

    if dev then
        cmd = string.format("%s dev %s", cmd, dev)
    end
    if priority then
        cmd = string.format("%s priority %s", cmd, priority)
    end
    cmd = string.format("%s -c '%s'", CLISH_CMD, cmd)
    print(cmd)
    local result = execute_command(cmd)
    return result

end

setmetatable(ipv4_routes, meta)
return ipv4_routes