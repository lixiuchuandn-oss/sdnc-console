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
                self.add_segment_routing("srv6")
                self.add_segment_routing_locator("srv6", cur_table.locator)
                self.add_segment_routing_locator_prefix("srv6", cur_table.locator, cur_table.prefix)
            end
        end
        if op == "del" then
            self.del_segment_routing("srv6")
        end
    end
}


local segment_routing = {}

function segment_routing.add_segment_routing(type)
    if not type then
        return
    end
    cmd = string.format("%s -c 'segment-routing %s'", CLISH_CMD, type)
    print(cmd)
    local result = execute_command(cmd)
    return result
end
function segment_routing.del_segment_routing(type)
    if not type then
        return
    end
    cmd = string.format("%s -c 'no segment-routing %s'", CLISH_CMD, type)
    print(cmd)
    local result = execute_command(cmd)
    return result
end
function segment_routing.add_segment_routing_locator(type, locator)
    if not locator then
        return
    end
    cmd = string.format("%s -c 'segment-routing %s' -c 'locator %s'", CLISH_CMD, type, locator)
    print(cmd)
    local result = execute_command(cmd)
    return result
end
function segment_routing.del_segment_routing_locator(type, locator)
    if not locator then
        return
    end
    cmd = string.format("%s -c 'segment-routing %s' -c 'no locator %s'", CLISH_CMD, type, locator)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function segment_routing.add_segment_routing_locator_prefix(type, locator, prefix)
    if not locator or not prefix then
        return
    end
    cmd = string.format("%s -c 'segment-routing %s' -c 'locator %s' -c 'prefix %s'", CLISH_CMD, type, locator, prefix)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

function segment_routing.del_segment_routing_locator_prefix(type)
    if not type then
        return
    end
    cmd = string.format("%s -c 'no segment-routing %s'", CLISH_CMD, type)
    print(cmd)
    local result = execute_command(cmd)
    return result
end

setmetatable(segment_routing, meta)
return segment_routing
