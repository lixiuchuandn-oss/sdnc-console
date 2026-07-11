#!/usr/bin/env lua
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
                for _, vrf_name in pairs(cur_table) do
                    self.add_vrf(vrf_name)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table ~= nil then
                for _, vrf_name in pairs(new_table) do
                    self.add_vrf(vrf_name)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, new_vrf_name in pairs(new_table) do
                    local found = false
                    for _, cur_vrf_name in pairs(cur_table) do
                        if new_vrf_name == cur_vrf_name then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.add_vrf(new_vrf_name)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table ~= nil and not new_table then
                for _, cur_vrf_name in pairs(cur_table) do
                    self.del_vrf(cur_vrf_name)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, cur_vrf_name in pairs(cur_table) do
                    local found = false
                    for _, new_vrf_name in pairs(new_table) do
                        if cur_vrf_name == new_vrf_name then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.del_vrf(cur_vrf_name)
                    end
                end
            end
        elseif op == "del" then
            for _, cur_vrf_name in pairs(cur_table) do
                self.del_vrf(cur_vrf_name)
            end
        end
    end
}


local vrf = {}

function vrf.add_vrf(vrf_name)
    if vrf_name == nil then
        return
    end
    local cmd = string.format("%s -c 'vrf %i'", CLISH_CMD, vrf_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function vrf.del_vrf(vrf_name)
    if vrf_name == nil then
        return
    end
    local cmd = string.format("%s -c 'no vrf %i'", CLISH_CMD, vrf_name)
    print(cmd)
    local result = execute_command(cmd)
    return result
end
setmetatable(vrf, meta)
return vrf