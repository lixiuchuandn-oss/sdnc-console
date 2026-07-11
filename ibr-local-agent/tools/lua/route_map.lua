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
            if cur_table ~= nil then
                for _, route_map_table in pairs(cur_table) do
                    self.add_route_map_part(route_map_table)
                end
            end
        
        elseif op == "cmp_add" then
            if not cur_table and new_table ~= nil then
                for _, route_map_table in pairs(new_table) do
                    self.add_route_map_part(route_map_table)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, new_route_map_table in pairs(new_table) do
                    local found = false
                    for _, cur_route_map_table in pairs(cur_table) do
                        if self.compare_route_map(cur_route_map_table, new_route_map_table) then
                            found = true
                        end
                    end
                    if not found then
                        self.add_route_map_part(new_route_map_table)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table ~= nil and new_table == nil then
                for _, cur_route_map_table in pairs(cur_table) do
                    self.del_route_map_part(cur_route_map_table)
                end
            end
            if cur_table and new_table then
                for _, cur_route_map_table in pairs(cur_table) do
                    local found = false
                    for _, new_route_map_table in pairs(new_table) do
                        if self.compare_route_map(cur_route_map_table, new_route_map_table) then
                            found = true
                        end
                    end
                    if not found then
                        self.del_route_map_part(cur_route_map_table)
                    end
                end
            end
        elseif op == "del" then
            if cur_table ~= nil then
                for _, route_map_table in pairs(cur_table) do
                    self.del_route_map_part(route_map_table.name)
                end
            end
        end
    end
}


local route_map = {}

function route_map.compare_route_map(cur_table, new_table)
    return cur_table.name == new_table.name
end


function route_map.add_route_map_part(table)
    if not table then
        return
    end
    route_map.add_route_map(table.name,table.type)
    route_map.add_route_map_match_prefix(table.name,table.type,table.match_prefix)
    route_map.add_route_map_set_metric(table.name,table.type,table.metric)
end
function route_map.del_route_map_part(table)
    if not table then
        return
    end
    route_map.del_route_map(table.name)
end

function route_map.add_route_map(route_map_name,type)
    if not route_map_name or not type then
        return
    end
    local cmd = string.format("%s -c 'route-map %s  %s'", CLISH_CMD, route_map_name, type)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function route_map.del_route_map(route_map_name)
    if not route_map_name then
        return
    end
    local cmd = string.format("%s -c 'no route-map %s'", CLISH_CMD, route_map_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function route_map.add_route_map_match_prefix(route_map_name, type, prefix)
    if not route_map_name or not type or not prefix then
        return
    end
    local cmd = string.format("%s -c 'route-map %s %s' -c 'match ip address prefix-list %s'", CLISH_CMD, route_map_name, type, prefix)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function route_map.del_route_map_set_prefix(route_map_name,type,prefix)
    if not route_map_name or not type or not prefix then
        return
    end
    local cmd = string.format("%s -c 'route-map %s %s' -c 'no match ip address prefix-list %s'", CLISH_CMD, route_map_name, type, prefix)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function route_map.add_route_map_set_metric(route_map_name,type,metric)
    if not route_map_name or not type or not metric then
        return
    end
    local cmd = string.format("%s -c 'route-map %s %s' -c 'set metric %i'", CLISH_CMD, route_map_name, type, metric)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function route_map.del_route_map_set_metric(route_map_name,type)
    if not route_map_name or not type then
        return
    end
    local cmd = string.format("%s -c 'route-map %s %s' -c 'no set metric'", CLISH_CMD, route_map_name, type)
    print(cmd)
    local result = execute_command(cmd)
    return result
end


setmetatable(route_map, meta)

return route_map