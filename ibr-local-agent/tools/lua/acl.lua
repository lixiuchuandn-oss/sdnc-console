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
                for _, acl_config in pairs(cur_table) do
                    self.add_acl_part(acl_config)
                end
            end
        elseif op == "cmp_add" then
            if not cur_table and new_table ~= nil then
                for _, acl_config in pairs(new_table) do
                    self.add_acl_part(acl_config)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, new_acl_config in pairs(new_table) do
                    local found = false
                    for _, cur_acl_config in pairs(cur_table) do
                        if cur_acl_config.acl_id == new_acl_config.acl_id then
                            found = true
                            -- 比较并更新ACL规则
                            self.cmp_add_acl_rule_part(cur_acl_config.acl_id, cur_acl_config.rule, new_acl_config.rule)
                            break
                        end
                    end
                    if not found then
                        self.add_acl_part(new_acl_config)
                    end
                end
            end
        elseif op == "cmp_del" then
            if cur_table and not new_table then
                for _, acl_config in pairs(cur_table) do
                    self.del_acl_part(acl_config)
                end
            end
            if cur_table ~= nil and new_table ~= nil then
                for _, cur_acl_config in pairs(cur_table) do
                    local found = false
                    for _, new_acl_config in pairs(new_table) do
                        if cur_acl_config.acl_id == new_acl_config.acl_id then
                            found = true
                            -- 比较并删除ACL规则
                            self.cmp_del_acl_rule_part(cur_acl_config.acl_id, cur_acl_config.rule, new_acl_config.rule)
                            break
                        end
                    end
                    if not found then
                        self.del_acl_part(cur_acl_config)
                    end
                end
            end
        elseif op == "del" then
            if cur_table and not new_table then
                for _, acl_config in pairs(cur_table) do
                    self.del_acl_part(acl_config)
                end
            end
        end
    end
}
--[[
"acl": [
    {
        "acl_id": 2000,
        "rule": [
            {
                "rule_id": 5,
                "match": "permit",
                "proto": "tcp",
                "source": "10.1.1.0/24",
                "sport": "10",
                "destination": "10.2.2.2/16",
                "dport": "10"
            }
        ]
    }
]
]]

local acl = {}

function acl.add_acl_part(cur_table)
    if not cur_table then
        return
    end
    if cur_table.acl_id then
        -- 创建ACL
        local cmd = string.format("%s -c 'acl %d'", CLISH_CMD, cur_table.acl_id)
        execute_command(cmd)
        
        -- 添加ACL规则
        if cur_table.rule and type(cur_table.rule) == "table" then
            for _, rule in pairs(cur_table.rule) do
                acl.add_acl_rule(cur_table.acl_id, rule)
            end
        end
    end
end

function acl.del_acl_part(cur_table)
    if not cur_table then
        return
    end
    if cur_table.acl_id then
        -- 删除ACL
        local cmd = string.format("%s -c 'no acl %d'", CLISH_CMD, cur_table.acl_id)
        execute_command(cmd)
    end
end

function acl.add_acl_rule(acl_id, rule)
    if not rule then
        return
    end
    
    -- 构建ACL规则命令
    local rule_cmd
    if rule.proto then
        rule_cmd = string.format("rule %d %s %s", rule.rule_id, rule.match, rule.proto)
    else
        rule_cmd = string.format("rule %d %s", rule.rule_id, rule.match)
    end
    
    -- 添加源地址
    if rule.source then
        rule_cmd = rule_cmd .. string.format(" source %s", rule.source)
    end
    
    -- 添加目的地址
    if rule.destination then
        rule_cmd = rule_cmd .. string.format(" destination %s", rule.destination)
    end
        
    -- 添加源端口
    if rule.sport then
        -- 将端口号转换为整数，去掉.0
        local sport = tonumber(rule.sport)
        if sport then
            rule_cmd = rule_cmd .. string.format(" sport %d", sport)
        end
    end
    
    -- 添加目的端口
    if rule.dport then
        -- 将端口号转换为整数，去掉.0
        local dport = tonumber(rule.dport)
        if dport then
            rule_cmd = rule_cmd .. string.format(" dport %d", dport)
        end
    end
    
    -- 执行ACL规则配置命令
    local cmd = string.format("%s -c 'acl %d' -c 'no commit' -c '%s' -c 'commit'", CLISH_CMD, acl_id, rule_cmd)
    execute_command(cmd)
end

function acl.del_acl_rule(acl_id, rule_id)
    -- 执行ACL规则删除命令
    local cmd = string.format("%s -c 'acl %d' -c 'no commit' -c 'no rule %d' -c 'commit'", CLISH_CMD, acl_id, rule_id)
    execute_command(cmd)
end

function acl.cmp_add_acl_rule_part(acl_id, cur_table, new_table)
    if not cur_table and new_table ~= nil then
        -- 只有新表，添加所有规则
        for _, rule in pairs(new_table) do
            acl.add_acl_rule(acl_id, rule)
        end
    end
    if cur_table ~= nil and new_table ~= nil then
        -- 新旧表都存在，比较并更新规则
        for _, new_rule in pairs(new_table) do
            local found = false
            local need_update = false
            for _, cur_rule in pairs(cur_table) do
                if cur_rule.rule_id == new_rule.rule_id then
                    found = true
                    -- 比较规则的其他属性是否相同
                    if cur_rule.match ~= new_rule.match or 
                       cur_rule.proto ~= new_rule.proto or 
                       cur_rule.source ~= new_rule.source or 
                       cur_rule.sport ~= new_rule.sport or 
                       cur_rule.destination ~= new_rule.destination or 
                       cur_rule.dport ~= new_rule.dport then
                        -- 规则属性发生变化，需要更新
                        need_update = true
                    end
                    break
                end
            end
            if not found then
                -- 新规则，添加
                acl.add_acl_rule(acl_id, new_rule)
            elseif need_update then
                -- 规则ID存在但属性变化，先删除旧规则再添加新规则
                acl.del_acl_rule(acl_id, new_rule.rule_id)
                acl.add_acl_rule(acl_id, new_rule)
            end
        end
    end
end

function acl.cmp_del_acl_rule_part(acl_id, cur_table, new_table)
    if cur_table and not new_table then
        -- 只有旧表，删除所有规则
        for _, rule in pairs(cur_table) do
            acl.del_acl_rule(acl_id, rule.rule_id)
        end
    end
    if cur_table ~= nil and new_table ~= nil then
        -- 新旧表都存在，比较并删除差异
        for _, cur_rule in pairs(cur_table) do
            local found = false
            for _, new_rule in pairs(new_table) do
                if cur_rule.rule_id == new_rule.rule_id then
                    found = true
                    break
                end
            end
            if not found then
                -- 旧规则不存在于新表，删除
                acl.del_acl_rule(acl_id, cur_rule.rule_id)
            end
        end
    end
end

setmetatable(acl, meta)
return acl