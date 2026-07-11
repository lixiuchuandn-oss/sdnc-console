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
                for _, cur_route_table in pairs(cur_table) do
                    self.add_ipv6_route(cur_route_table)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table then
                for _, new_route_table in pairs(new_table) do
                    self.add_ipv6_route(new_route_table)
                end
            end
            if cur_table and new_table then
                for _, new_route_table in pairs(new_table) do
                    local found = false
                    for _, cur_route_table in pairs(cur_table) do
                        if self.compare_ipv6_route(cur_route_table, new_route_table) then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.add_ipv6_route(new_route_table)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table and not new_table then
                for _, cur_route_table in pairs(cur_table) do
                    self.del_ipv6_route(cur_route_table)
                end
            end
            if cur_table and new_table then
                for _, cur_route_table in pairs(cur_table) do
                    local found = false
                    for _, new_route_table in pairs(new_table) do
                        if self.compare_ipv6_route(cur_route_table, new_route_table) then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.del_ipv6_route(cur_route_table)
                    end
                end
            end 
        elseif op == "del" then
            if cur_table and not new_table then
                for _, cur_route_table in pairs(cur_table) do
                    self.del_ipv6_route(cur_route_table)
                end
            end
        end
    end
}

local ipv6_routes = {}
function ipv6_routes.compare_ipv6_route(route_table1, route_table2)
    return route_table1.vrf == route_table2.vrf 
    and route_table1.destination == route_table2.destination 
    and route_table1.via == route_table2.via 
    and route_table1.dev == route_table2.dev 
    and route_table1.priority == route_table2.priority
end

function ipv6_routes.add_ipv6_route(route_table)
    local vrf = route_table.vrf
    local destination = route_table.destination
    local via = route_table.via
    local dev = route_table.dev
    local cmd = "ipv6 route "

    if vrf then
        cmd = string.format("%s vrf %i", cmd, vrf)
    end
    if destination then
        cmd = string.format("%s %s", cmd, destination)
    end
    if via then
        cmd = string.format("%s via %s", cmd, via)
    end
    if dev then
        cmd = string.format("%s dev %s", cmd, dev)
    end
    cmd = string.format("%s -c '%s'", CLISH_CMD, cmd)
    print(cmd)
    execute_command(cmd)

end

function ipv6_routes.del_ipv6_route(route_table)
    local vrf = route_table.vrf
    local destination = route_table.destination
    local via = route_table.via
    local dev = route_table.dev
    local cmd = "no ipv6 route "

    if vrf then
        cmd = string.format("%s vrf %i", cmd, vrf)
    end
    if destination then
        cmd = string.format("%s %s", cmd, destination)
    end
    if via then
        cmd = string.format("%s via %s", cmd, via)
    end
    if dev then
        cmd = string.format("%s dev %s", cmd, dev)
    end
    cmd = string.format("%s -c '%s'", CLISH_CMD, cmd)
    print(cmd)
    execute_command(cmd)

end
setmetatable(ipv6_routes, meta)
return ipv6_routes
