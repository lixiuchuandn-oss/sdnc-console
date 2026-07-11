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
                for _, vrrp_group in pairs(cur_table) do
                    self.add_vrrp_part(vrrp_group)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table ~= nil then
                for _, vrrp_group in pairs(new_table) do
                    self.add_vrrp_part(vrrp_group)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, new_vrrp_group in pairs(new_table) do
                    local found = false
                    for _, cur_vrrp_group in pairs(cur_table) do
                        if cur_vrrp_group.group_id == new_vrrp_group.group_id then
                            found = true
                            self.cmp_add_vrrp_track_gateway_part(cur_vrrp_group.group_id, cur_vrrp_group.track_gateway, new_vrrp_group.track_gateway)
                            self.cmp_add_vrrp_vrid_part(cur_vrrp_group.group_id, cur_vrrp_group.vrrp_instance, new_vrrp_group.vrrp_instance)
                            break
                        end
                    end
                    if not found then
                        self.add_vrrp_part(new_vrrp_group)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table and not new_table then
                for _, vrrp_group in pairs(cur_table) do
                    self.del_vrrp_part(vrrp_group)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, cur_vrrp_group in pairs(cur_table) do
                    local found = false
                    for _, new_vrrp_group in pairs(new_table) do
                        if cur_vrrp_group.group_id == new_vrrp_group.group_id then
                            found = true
                            self.cmp_del_vrrp_track_gateway_part(cur_vrrp_group.group_id, cur_vrrp_group.track_gateway, new_vrrp_group.track_gateway)
                            self.cmp_del_vrrp_vrid_part(cur_vrrp_group.group_id, cur_vrrp_group.vrrp_instance, new_vrrp_group.vrrp_instance)
                            break
                        end
                    end
                    if not found then
                        self.del_vrrp_part(cur_vrrp_group)
                    end
                end
            end
        elseif op == "del" then
            if cur_table and not new_table then
                for _, vrrp_group in pairs(cur_table) do
                    self.del_vrrp_part(vrrp_group)
                end
            end
        end
    end
}
--[[
"vrrp" : [
		{
			"group_id" : 1,
			"track_gateway" :[
				"1.1.1.1",
				"22.22.2.2"
			],
			"vrrp_instance" : [
				1,
				2
			]
		}
]]

local vrrp = {}

function vrrp.add_vrrp_part(cur_table)
    if not cur_table then
        return
    end
    if cur_table.group_id then
        vrrp.add_vrrp_group(cur_table.group_id)
    end
    for _, gateway_ip in pairs(cur_table.track_gateway) do
        vrrp.add_vrrp_track_gateway(cur_table.group_id, gateway_ip)
    end
    for _, vrid in pairs(cur_table.vrrp_instance) do
        vrrp.add_vrrp_vrid(cur_table.group_id, vrid)
    end
end

function vrrp.del_vrrp_part(cur_table)
    if not cur_table then
        return
    end
    if cur_table.group_id then
        vrrp.del_vrrp_group(cur_table.group_id)
    end
end

function vrrp.cmp_add_vrrp_track_gateway_part(vrid, cur_table, new_table)
    if not cur_table and new_table ~= nil then
        for _, gateway_ip in pairs(new_table) do
            vrrp.add_vrrp_track_gateway(vrid, gateway_ip)
        end
    end
    if cur_table ~= nil and new_table ~= nil then
        for _, new_gateway_ip in pairs(new_table) do
            local found = false
            for _, cur_gateway_ip in pairs(cur_table) do
                if cur_gateway_ip == new_gateway_ip then
                    found = true
                    break
                end
            end
            if not found then
                vrrp.add_vrrp_track_gateway(vrid, new_gateway_ip)
            end
        end
    end
end

function vrrp.cmp_del_vrrp_track_gateway_part(vrid, cur_table, new_table)
    if cur_table and not new_table then
        for _, gateway_ip in pairs(cur_table) do
            vrrp.del_vrrp_track_gateway(vrid, gateway_ip)
        end
    end
    if cur_table ~= nil and new_table ~= nil then
        for _, cur_gateway_ip in pairs(cur_table) do
            local found = false
            for _, new_gateway_ip in pairs(new_table) do
                if cur_gateway_ip == new_gateway_ip then
                    found = true
                    break
                end
            end
            if not found then
                vrrp.del_vrrp_track_gateway(vrid, cur_gateway_ip)
            end
        end
    end
end

function vrrp.cmp_add_vrrp_vrid_part(vrid, cur_table, new_table)
    if not cur_table and new_table ~= nil then
        for _, vrid in pairs(new_table) do
            vrrp.add_vrrp_vrid(vrid)
        end
    end
    if cur_table ~= nil and new_table ~= nil then
        for _, new_vrid in pairs(new_table) do
            local found = false
            for _, cur_vrid in pairs(cur_table) do
                if cur_vrid == new_vrid then
                    found = true
                    break
                end
            end
            if not found then
                vrrp.add_vrrp_vrid(vrid, new_vrid)
            end
        end 
    end
end

function vrrp.cmp_del_vrrp_vrid_part(vrid, cur_table, new_table)
    if cur_table and not new_table then
        for _, vrid in pairs(cur_table) do
            vrrp.del_vrrp_vrid(vrid)
        end
    end
    if cur_table ~= nil and new_table ~= nil then
        for _, cur_vrid in pairs(cur_table) do
            local found = false
            for _, new_vrid in pairs(new_table) do
                if cur_vrid == new_vrid then
                    found = true
                    break
                end
            end
            if not found then
                vrrp.del_vrrp_vrid(vrid, cur_vrid)
            end
        end
    end
end

function vrrp.add_vrrp_group(vrrp_group_id)
    local cmd = string.format("%s -c 'vrrp group %i'", CLISH_CMD, vrrp_group_id)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function vrrp.del_vrrp_group(vrrp_group_id)
    local cmd = string.format("%s -c 'no vrrp group %i'", CLISH_CMD, vrrp_group_id)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function vrrp.add_vrrp_track_gateway(vrrp_group_id, gateway_ip)
    local cmd = string.format("%s -c 'vrrp group %i' -c 'track-gateway %s'", CLISH_CMD, vrrp_group_id, gateway_ip)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function vrrp.del_vrrp_track_gateway(vrrp_group_id, gateway_ip)
    local cmd = string.format("%s -c 'vrrp group %i' -c 'no track-gateway %s'", CLISH_CMD, vrrp_group_id, gateway_ip)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function vrrp.add_vrrp_vrid(vrrp_group_id, vrid)
    local cmd = string.format("%s -c 'vrrp group %i' -c 'vrid %i'", CLISH_CMD, vrrp_group_id, vrid)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function vrrp.del_vrrp_vrid(vrrp_group_id, vrid)
    local cmd = string.format("%s -c 'vrrp group %i' -c 'no vrid %i'", CLISH_CMD, vrrp_group_id, vrid)
    print(cmd)
    local result = execute_command(cmd)
    return result
end


setmetatable(vrrp, meta)
return vrrp
