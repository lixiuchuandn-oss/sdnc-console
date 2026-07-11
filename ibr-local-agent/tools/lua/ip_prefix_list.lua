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
                for _, cur_ip_prefix_list in pairs(cur_table) do
                    self.add_ip_prefix_list_part(cur_ip_prefix_list)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table ~= nil then
                for _, new_ip_prefix_list in pairs(new_table) do
                    self.add_ip_prefix_list_part(new_ip_prefix_list)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, new_ip_prefix_list in pairs(new_table) do
                    local found = false
                    for _, cur_ip_prefix_list in pairs(cur_table) do
                        if self.compare_ip_prefix_list(cur_ip_prefix_list, new_ip_prefix_list) then
                            found = true
                        end
                    end
                    if not found then
                        self.add_ip_prefix_list_part(new_ip_prefix_list)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table and not new_table then
                for _, cur_ip_prefix_list in pairs(cur_table) do
                    self.del_ip_prefix_list_part(cur_ip_prefix_list)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, cur_ip_prefix_list in pairs(cur_table) do
                    local found = false
                    for _, new_ip_prefix_list in pairs(new_table) do
                        if self.compare_ip_prefix_list(cur_ip_prefix_list, new_ip_prefix_list) then
                            found = true
                        end
                    end
                    if not found then
                        self.del_ip_prefix_list_part(cur_ip_prefix_list)
                    end
                end
            end
        elseif op == "del" then
            if cur_table ~= nil then
                for _, cur_ip_prefix_list in pairs(cur_table) do
                    self.del_ip_prefix_list(cur_ip_prefix_list)
                end
            end
        end
    end
}

local ip_prefix_list = {}

function ip_prefix_list.compare_ip_prefix_list(table1, table2)
    if not table1 or not table2 then
        return
    end
    if table1.name ~= table2.name then
        return false
    end
    return true
end
function ip_prefix_list.add_ip_prefix_list_part(cur_table)
    if not cur_table.name or not cur_table.type or not cur_table.range then
        return 
    end
    local cmd = string.format("%s -c 'ip prefix-list %s %s %s'", CLISH_CMD, cur_table.name, cur_table.type, cur_table.range)
    print(cmd)
    execute_command(cmd)
end
function ip_prefix_list.del_ip_prefix_list_part(cur_table)
    if not cur_table.name then
        return 
    end

    local cmd = string.format("%s -c 'no ip prefix-list %s'", CLISH_CMD, cur_table.name)
    print(cmd)
    execute_command(cmd)
end
function ip_prefix_list.add_ip_prefix_list(name, type, range)
    if not name or not type or not range then
        return 
    end
    local cmd = string.format("%s -c 'ip prefix-list %s %s %s'", CLISH_CMD, name, type, range)
    print(cmd)
    execute_command(cmd)
end

function ip_prefix_list.del_ip_prefix_list(name)
    if not name then
        return 
    end
    local cmd = string.format("%s -c 'no ip prefix-list %s'", CLISH_CMD, name)
    print(cmd)
    execute_command(cmd)
end

setmetatable(ip_prefix_list, meta)

return ip_prefix_list
