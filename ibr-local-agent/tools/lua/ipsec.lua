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

local function tables_equal(t1, t2)
    if t1 == t2 then
        return true
    end
    if not t1 or not t2 then
        return false
    end
    for k, v in pairs(t1) do
        if t2[k] == nil then
            return false
        end
        if type(v) == "table" then
            if not tables_equal(v, t2[k]) then
                return false
            end
        else
            if t2[k] ~= v then
                return false
            end
        end
    end
    for k, _ in pairs(t2) do
        if t1[k] == nil then
            return false
        end
    end
    return true
end

local meta = {
    __call = function(self, op, cur_table, new_table)
        if op == "add" then
            if cur_table ~= nil then
                for _, ipsec_config in pairs(cur_table) do
                    self.add_ipsec_part(ipsec_config)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table ~= nil then
                for _, ipsec_config in pairs(new_table) do
                    self.add_ipsec_part(ipsec_config)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, new_ipsec_config in pairs(new_table) do
                    local found = false
                    for _, cur_ipsec_config in pairs(cur_table) do
                        if cur_ipsec_config.ID == new_ipsec_config.ID then
                            found = true
                            if not tables_equal(cur_ipsec_config, new_ipsec_config) then
                                self.del_ipsec_part(cur_ipsec_config)
                                self.add_ipsec_part(new_ipsec_config)
                            end
                            break
                        end
                    end
                    if not found then
                        self.add_ipsec_part(new_ipsec_config)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table and not new_table then
                for _, ipsec_config in pairs(cur_table) do
                    self.del_ipsec_part(ipsec_config)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, cur_ipsec_config in pairs(cur_table) do
                    local found = false
                    for _, new_ipsec_config in pairs(new_table) do
                        if cur_ipsec_config.ID == new_ipsec_config.ID then
                            found = true
                            break
                        end
                    end
                    if not found then
                        self.del_ipsec_part(cur_ipsec_config)
                    end
                end
            end
        elseif op == "del" then
            if cur_table and not new_table then
                for _, ipsec_config in pairs(cur_table) do
                    self.del_ipsec_part(ipsec_config)
                end
            end
        end
    end
}
--[[
"ipsec": [
    {
        "ID": "1",
        "ike_local_ip": "100.1.1.2",
        "ike_remote_ip": "101.1.1.2",
        "ike_dpd_delay": 10,
        "ike_dpd_timeout": 30,
        "ike_mode": "aggressive",
        "ike_proposal_local": "vr1",
        "ike_proposal_remote": {
            "remote_id": "vr2",
            "pre_shared_key": "123456",
            "pubkey": "pre-shared-key"
        },
        "traffic_selectors_local": "100.1.1.0/24, 171.100.101.0/24",
        "traffic_selectors_remote": "102.1.1.0/24, 179.100.101.0/24",
        "vrf_id": "9999",
        "sa_dpd_action": "restart",
        "sa_esp_proposals": "aes256-sha256-modp2048",
        "sa-initiate": "true",
        "sa-terminate": "true"
    }
]
]]

local ipsec = {}

function ipsec.add_ipsec_part(cur_table)
    if not cur_table then
        return
    end
    if cur_table.ID then
        local tun_name = cur_table.ID
        local cmd = string.format("%s -c 'ipsec %s'", CLISH_CMD, tun_name)
        execute_command(cmd)
        
        -- 检查ike_local_ip和ike_remote_ip是否存在
        if cur_table.ike_local_ip and cur_table.ike_remote_ip then
            cmd = string.format("%s -c 'ipsec %s' -c 'ike local-ip %s remote-ip %s'", 
                CLISH_CMD, tun_name, cur_table.ike_local_ip, cur_table.ike_remote_ip)
            execute_command(cmd)
        end
        
        -- 检查ike_dpd_delay是否存在
        if cur_table.ike_dpd_delay then
            cmd = string.format("%s -c 'ipsec %s' -c 'ike-dpd-delay %d'", 
                CLISH_CMD, tun_name, cur_table.ike_dpd_delay)
            execute_command(cmd)
        end
        
        -- 检查ike_dpd_timeout是否存在
        if cur_table.ike_dpd_timeout then
            cmd = string.format("%s -c 'ipsec %s' -c 'ike-dpd-timeout %d'", 
                CLISH_CMD, tun_name, cur_table.ike_dpd_timeout)
            execute_command(cmd)
        end
        
        -- 检查ike_mode是否存在
        if cur_table.ike_mode then
            cmd = string.format("%s -c 'ipsec %s' -c 'ike-mode %s'", 
                CLISH_CMD, tun_name, cur_table.ike_mode)
            execute_command(cmd)
        end
        
        -- 检查ike_proposal_local是否存在
        if cur_table.ike_proposal_local then
            cmd = string.format("%s -c 'ipsec %s' -c 'ike-proposal-local %s'", 
                CLISH_CMD, tun_name, cur_table.ike_proposal_local)
            execute_command(cmd)
        end
        
        -- 检查ike_proposal_remote及其内部属性是否存在
        if cur_table.ike_proposal_remote and cur_table.ike_proposal_remote.remote_id and cur_table.ike_proposal_remote.pre_shared_key then
            cmd = string.format("%s -c 'ipsec %s' -c 'ike-proposal-remote %s pre-shared-key %s'", 
                CLISH_CMD, tun_name, cur_table.ike_proposal_remote.remote_id, cur_table.ike_proposal_remote.pre_shared_key)
            execute_command(cmd)
        end
        
        -- 检查traffic_selectors_local是否存在
        if cur_table.traffic_selectors_local then
            cmd = string.format("%s -c 'ipsec %s' -c 'traffic-selectors-local %s'", 
                CLISH_CMD, tun_name, cur_table.traffic_selectors_local)
            execute_command(cmd)
        end
        
        -- 检查traffic_selectors_remote是否存在
        if cur_table.traffic_selectors_remote then
            cmd = string.format("%s -c 'ipsec %s' -c 'traffic-selectors-remote %s'", 
                CLISH_CMD, tun_name, cur_table.traffic_selectors_remote)
            execute_command(cmd)
        end
        
        -- 检查vrf_id是否存在
        if cur_table.vrf_id then
            cmd = string.format("%s -c 'ipsec %s' -c 'vrf %s'", 
                CLISH_CMD, tun_name, cur_table.vrf_id)
            execute_command(cmd)
        end
        
        -- 检查sa_dpd_action是否存在
        if cur_table.sa_dpd_action then
            cmd = string.format("%s -c 'ipsec %s' -c 'sa-dpd-action %s'", 
                CLISH_CMD, tun_name, cur_table.sa_dpd_action)
            execute_command(cmd)
        end
        
        -- 检查sa_esp_proposals是否存在
        if cur_table.sa_esp_proposals then
            cmd = string.format("%s -c 'ipsec %s' -c 'sa-esp-proposals %s'", 
                CLISH_CMD, tun_name, cur_table.sa_esp_proposals)
            execute_command(cmd)
        end

        cmd = string.format("%s -c 'ipsec %s' -c 'ipsec-commit'", CLISH_CMD, tun_name)
        execute_command(cmd)
        
        -- 检查sa-initiate是否为true
        if cur_table["sa-initiate"] == "true" then
            cmd = string.format("%s -c 'ipsec %s' -c 'sa-initiate'", CLISH_CMD, tun_name)
            execute_command(cmd)
        end
        
        -- 检查sa-terminate是否为true
        if cur_table["sa-terminate"] == "true" then
            cmd = string.format("%s -c 'ipsec %s' -c 'sa-terminate'", CLISH_CMD, tun_name)
            execute_command(cmd)
        end
    end
end

function ipsec.del_ipsec_part(cur_table)
    if not cur_table then
        return
    end
    if cur_table.ID then
        local tun_name = cur_table.ID
        local cmd = string.format("%s -c 'no ipsec %s'", CLISH_CMD, tun_name)
        execute_command(cmd)
    end
end

setmetatable(ipsec, meta)
return ipsec