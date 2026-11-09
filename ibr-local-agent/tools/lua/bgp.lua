#!/usr/bin/env lua
package.path = package.path .. ";/rhos/etc/agent/tools/lua/?.lua"
package.path = package.path .. ";/home/lua/vrctl/?.lua"

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
            if cur_table.bgp ~= nil then
                for _, p in pairs(cur_table.bgp) do
                    self.add_part(cur_table.segment_routing_srv6, p)
                end
            end
        elseif op == "update" then
            if cur_table.bgp == nil and new_table.bgp == nil then
                return 0
            end
            if cur_table.bgp == nil and new_table.bgp then
                for _, p in pairs(new_table.bgp) do
                    self.add_part(new_table.segment_routing_srv6, p)
                end
                return 0
            end
            if new_table.bgp == nil and cur_table.bgp ~= nil then
                for i = #cur_table.bgp, 1, -1 do
                    local p = cur_table.bgp[i]
                    self.del_part(p)
                end
                return 0
            end
            for i = #cur_table.bgp, 1, -1 do
                local p = cur_table.bgp[i]
                local found = false
                if not p.asn then
                    return -1
                end
                local as1 = string.format("%i", p.asn)
                if p.vrf then
                    as1 = string.format("%i vrf %i", as1, p.vrf)
                end
                for _, p2 in pairs(new_table.bgp) do
                    if p2.asn then
                        local as2 = string.format("%i", p2.asn)
                        if p2.vrf then
                            as2 = string.format("%i vrf %i", as2, p2.vrf)
                        end
                        if as1 == as2 then
                            found = true
                        end
                    end
                end
                if not found then
                    self.del_part(p)
                end
            end
            for _, p in pairs(new_table.bgp) do
                local found = false
                local as1 = string.format("%i", p.asn)
                if p.vrf then
                    as1 = string.format("%i vrf %i", as1, p.vrf)
                end
                for _, p2 in pairs(cur_table.bgp) do
                    local as2 = string.format("%i", p2.asn)
                    if p2.vrf then
                        as2 = string.format("%i vrf %i", as2, p2.vrf)
                    end
                    if as1 == as2 then
                        found = true
                        self.update(p2, p, new_table.segment_routing_srv6, cur_table.bgp)
                    end
                end
                if not found then
                    self.add_part(new_table.segment_routing_srv6, p)
                end
            end
        elseif op == "del" then
            for _, p in pairs(cur_table.bgp) do
                self.del_part(p)
            end
        end
    end
}

local bgp = {}

bgp.segment_routing = require("segment-routing")
function bgp.add_part(segment_routing_list, p)
    local as=""
    if p.asn == nil then
        return -1            
    end
    if p.asn ~= nil then
        as = string.format("%i", p.asn) 
    end
    if p.vrf ~= nil then
        as = string.format("%i vrf %i", as, p.vrf)
    end
    bgp.add_bgp(as)
    if p.router_id ~= nil then
        bgp.add_bgp_router_id(as, p.router_id)
    end
    if p.bgp_ebgp_requires_policy ~= nil then
        bgp.set_ebgp_require_policy(as, p.bgp_ebgp_requires_policy)
    end
    if p.timer_bgp_KA ~= nil or p.timer_bgp_HA ~= nil then
        bgp.add_bgp_timer_KA_HA(as, p.timer_bgp_KA, p.timer_bgp_HA)
    end
    if p.bgp_fast_convergence ~= nil then
        bgp.set_bgp_fast_convergence(as, p.bgp_fast_convergence)
    end
    if p.neighbor ~= nil then
        for _, n in pairs(p.neighbor) do
            bgp.add_bgp_neighbor(as, n.remote_ip, n.remote_as)
            if n.ebgp_multihop ~= nil then
                bgp.add_bgp_neighbor_ebgp_multihop(as, n.remote_ip, n.ebgp_multihop)
            end
        end
    end
    if p.neighbor_disable_connected_check ~= nil then
        for _, n in pairs(p.neighbor_disable_connected_check) do
            bgp.add_bgp_neighbor_disable_connected_check(as, n)
        end
    end
    if p.address_family ~= nil then
        for _, af in pairs(p.address_family) do
            bgp.add_address_family_part(as, af)
        end
    end
    if p.segment_routing_srv6 ~= nil then
        bgp.segment_routing.add_segment_routing("srv6")
        bgp.segment_routing.add_segment_routing_locator("srv6", segment_routing_list.locator)
        bgp.segment_routing.add_segment_routing_locator_prefix("srv6", segment_routing_list.locator, segment_routing_list.prefix)
        bgp.add_bgp_segment_routing(as)
        bgp.add_bgp_segment_routing_locator(as, p.segment_routing_srv6.locator)
    end
end

function bgp.add_address_family_part(as, af)
        bgp.add_bgp_address_family(as, af.address_family, af.modifiler)
        if af.neighbor_route_map ~= nil then
            for _, nr in pairs(af.neighbor_route_map) do
                bgp.add_bgp_address_family_neighbor_route_map(as, af.address_family, af.modifiler, nr.neighbor, nr.direction, nr.route_map)
            end
        end
        if af.activate_address_family ~= nil then
            for _, aa in pairs(af.activate_address_family) do
                bgp.add_bgp_address_family_active(as, af.address_family, af.modifiler, aa)
            end
        end
        if af.export_route ~= nil then
            bgp.set_bgp_address_family_export_route_status(as, af.address_family, af.modifiler, af.export_route)
        end
        if af.import_route ~= nil then
            bgp.set_bgp_address_family_import_route_status(as, af.address_family, af.modifiler, af.import_route)
        end
        if af.route_distinguisher ~= nil then
            bgp.add_bgp_address_family_route_distinguisher(as, af.address_family, af.modifiler, af.route_distinguisher)
        end
        if af.route_target ~= nil then
            bgp.add_bgp_address_family_route_target(as, af.address_family, af.modifiler, af.route_target)
        end
        if af.network ~= nil then
            for _, n in pairs(af.network) do
                bgp.add_bgp_address_family_network(as, af.address_family, af.modifiler, n)
            end
        end
        if af.auto_assign_sid ~= nil then
            bgp.set_bgp_address_family_auto_assign_sid_status(as, af.address_family, af.modifiler, af.auto_assign_sid)
        end
end

function bgp.del_part(p)
    local as = ""
    if p.asn ~= nil then
        as = string.format("%i", p.asn) 
    end
    if p.vrf ~= nil then
        as = string.format("%i vrf %i", as, p.vrf)
    end
    bgp.del_bgp(as)
    if p.segment_routing_srv6 ~= nil then
        bgp.segment_routing.del_segment_routing("srv6")
    end
end

function bgp.del_address_family_part(as, af)
        local address_family = af.address_family
        local modifiler = af.modifiler
        bgp.set_bgp_address_family_auto_assign_sid_status(as, address_family, modifiler, "disable")
        if af.network ~= nil then
            for _, n in pairs(af.network) do
                bgp.del_bgp_address_family_network(as, address_family, modifiler, n)
            end
        end
        if af.route_distinguisher ~= nil then
            bgp.del_bgp_address_family_route_distinguisher(as, address_family, modifiler, af.route_distinguisher)
        end
        if af.route_target ~= nil then
            bgp.del_bgp_address_family_route_target(as, address_family, modifiler, af.route_target)
        end
        if af.import_route ~= nil then
            bgp.set_bgp_address_family_import_route_status(as, address_family, modifiler, "disable")
        end
        if af.export_route ~= nil then
            bgp.set_bgp_address_family_export_route_status(as, address_family, modifiler, "disable")
        end
        if af.activate_address_family ~= nil then
            for _, aa in pairs(af.activate_address_family) do
                bgp.del_bgp_address_family_active(as, address_family, modifiler, aa)
            end
        end
        if af.neighbor_route_map ~= nil then
            for _, nr in pairs(af.neighbor_route_map) do
                bgp.del_bgp_address_family_neighbor_route_map(as, address_family, modifiler, nr.neighbor, nr.direction, nr.route_map)
            end
        end
end


function bgp.update(cur_bgp, new_bgp, segment_routing_srv6, cur_table)
    if cur_bgp == nil and new_bgp == nil then
        return
    end
    local bgp_as = string.format("%i", new_bgp.asn)
    if new_bgp.vrf ~= nil then
        bgp_as = string.format("%i vrf %i", bgp_as, new_bgp.vrf)
    end
    -- bgp_router_id
    if cur_bgp.router_id ~= new_bgp.router_id then
        print("bgp_router_id")
        bgp.del_bgp_router_id(bgp_as)
        bgp.add_bgp_router_id(bgp_as, new_bgp.router_id)
    end
    -- bgp_ebgp_requires_policy
    if cur_bgp.bgp_ebgp_requires_policy ~= new_bgp.bgp_ebgp_requires_policy then
        print("bgp_ebgp_requires_policy")
        bgp.set_ebgp_require_policy(bgp_as, new_bgp.bgp_ebgp_requires_policy)
    end
    -- timer_bgp_KA_HA
    if cur_bgp.timer_bgp_KA ~= new_bgp.timer_bgp_KA or cur_bgp.timer_bgp_HA ~= new_bgp.timer_bgp_HA then
        print("timer_bgp_KA_HA")
        bgp.del_bgp_timer_KA_HA(bgp_as)
        bgp.add_bgp_timer_KA_HA(bgp_as, new_bgp.timer_bgp_KA, new_bgp.timer_bgp_HA)
    end
    -- bgp_fast_convergence
    if cur_bgp.bgp_fast_convergence ~= new_bgp.bgp_fast_convergence then
        print("bgp_fast_convergence")
        bgp.set_bgp_fast_convergence(bgp_as, new_bgp.bgp_fast_convergence)
    end
    -- neighbor
    if cur_bgp.neighbor and not new_bgp.neighbor then
        for _, n in pairs(cur_bgp.neighbor) do
            bgp.del_bgp_neighbor(bgp_as, n.remote_ip)
        end
    elseif not cur_bgp.neighbor and new_bgp.neighbor then
        for _, n in pairs(new_bgp.neighbor) do
            bgp.add_bgp_neighbor(bgp_as, n.remote_ip, n.remote_as)
            if n.ebgp_multihop ~= nil then
                bgp.add_bgp_neighbor_ebgp_multihop(bgp_as, n.remote_ip, n.ebgp_multihop)
            end
        end
    elseif cur_bgp.neighbor and new_bgp.neighbor then
        bgp.compare_neighbor(bgp_as, cur_bgp.neighbor, new_bgp.neighbor)
    end
    -- neighbor_disable_connected_check
    if cur_bgp.neighbor_disable_connected_check and not new_bgp.neighbor_disable_connected_check then
        print("neighbor_disable_connected_check1")
        for _, n in pairs(cur_bgp.neighbor_disable_connected_check) do
            bgp.del_bgp_neighbor_disable_connected_check(bgp_as, n)
        end
    elseif not cur_bgp.neighbor_disable_connected_check and new_bgp.neighbor_disable_connected_check then
        print("neighbor_disable_connected_check2")
        for _, n in pairs(new_bgp.neighbor_disable_connected_check) do
            bgp.add_bgp_neighbor_disable_connected_check(bgp_as, n)
        end
    elseif cur_bgp.neighbor_disable_connected_check and new_bgp.neighbor_disable_connected_check then
        print("neighbor_disable_connected_check3")
        bgp.compare_neighbor_disable_connected_check(bgp_as, cur_bgp.neighbor_disable_connected_check, new_bgp.neighbor_disable_connected_check)
    end
    -- address_family
    bgp.update_address_family(bgp_as, cur_bgp.address_family, new_bgp.address_family)
    -- segment_routing_srv6
    if cur_bgp.segment_routing_srv6 and new_bgp.segment_routing_srv6 and cur_bgp.segment_routing_srv6.locator ~= new_bgp.segment_routing_srv6.locator then
        for _, p in pairs(cur_table) do
            local as = ""
            if p.asn ~= nil then
                as = string.format("%i", p.asn) 
            end
            if p.vrf ~= nil then
                as = string.format("%i vrf %i", as, p.vrf)
            end
            for _, af in pairs(p.address_family) do
                bgp.set_bgp_address_family_auto_assign_sid_status(as, af.address_family, af.modifiler, "disable")
            end
        end
        bgp.del_bgp_segment_routing(bgp_as)
        bgp.segment_routing.del_segment_routing("srv6")
        bgp.segment_routing.add_segment_routing_locator("srv6", segment_routing_srv6.locator)
        bgp.segment_routing.add_segment_routing_locator_prefix("srv6", segment_routing_srv6.locator, segment_routing_srv6.prefix)
        bgp.add_bgp_segment_routing(bgp_as)
        bgp.add_bgp_segment_routing_locator(bgp_as, new_bgp.segment_routing_srv6.locator)
    elseif not cur_bgp.segment_routing_srv6 and new_bgp.segment_routing_srv6 then
        bgp.segment_routing.del_segment_routing("srv6")
        bgp.segment_routing.add_segment_routing_locator("srv6", segment_routing_srv6.locator)
        bgp.segment_routing.add_segment_routing_locator_prefix("srv6", segment_routing_srv6.locator, segment_routing_srv6.prefix)
        bgp.add_bgp_segment_routing(bgp_as)
        bgp.add_bgp_segment_routing_locator(bgp_as, new_bgp.segment_routing_srv6.locator)
    elseif cur_bgp.segment_routing_srv6 and not new_bgp.segment_routing_srv6 then
        for _, p in pairs(cur_table) do
            local as = ""
            if p.asn ~= nil then
                as = string.format("%i", p.asn) 
            end
            if p.vrf ~= nil then
                as = string.format("%i vrf %i", as, p.vrf)
            end
            for _, af in pairs(p.address_family) do
                bgp.set_bgp_address_family_auto_assign_sid_status(as, af.address_family, af.modifiler, "disable")
            end
        end
        bgp.del_bgp_segment_routing(bgp_as)
    end
    --更新 外层segment_routing_srv6
    if not segment_routing_srv6 then
        bgp.segment_routing.del_segment_routing("srv6")
    end
    if segment_routing_srv6 then
        bgp.segment_routing.add_segment_routing("srv6")
        bgp.segment_routing.add_segment_routing_locator("srv6", segment_routing_srv6.locator)
        bgp.segment_routing.add_segment_routing_locator_prefix("srv6", segment_routing_srv6.locator, segment_routing_srv6.prefix)
    end
end

function bgp.compare_neighbor(as, cur_neighbor, new_neighbor)
    
    for _, n in pairs(cur_neighbor) do
        local found = false
        for _, n2 in pairs(new_neighbor) do
            if n.remote_ip == n2.remote_ip and n.remote_as == n2.remote_as then
                found = true
                -- 同 peer 时同步 ebgp-multihop（现网 PE–PE 公网邻居必需）
                if n.ebgp_multihop ~= n2.ebgp_multihop then
                    if n2.ebgp_multihop ~= nil then
                        bgp.add_bgp_neighbor_ebgp_multihop(as, n2.remote_ip, n2.ebgp_multihop)
                    elseif n.ebgp_multihop ~= nil then
                        bgp.del_bgp_neighbor_ebgp_multihop(as, n.remote_ip)
                    end
                end
                break
            end
        end
        if not found then
            print(n.remote_ip)
            print(as)
            bgp.del_bgp_neighbor(as, n.remote_ip)
        end
    end

    for _, n in pairs(new_neighbor) do
        local found = false
        for _, n2 in pairs(cur_neighbor) do
            if n.remote_ip == n2.remote_ip and n.remote_as == n2.remote_as then
                found = true
                break
            end
        end
        if not found then
            bgp.add_bgp_neighbor(as, n.remote_ip, n.remote_as)
            if n.ebgp_multihop ~= nil then
                bgp.add_bgp_neighbor_ebgp_multihop(as, n.remote_ip, n.ebgp_multihop)
            end
        end
    end
    
end

function bgp.compare_neighbor_disable_connected_check(as, cur_neighbor_disable_connected_check, new_neighbor_disable_connected_check)
    for _, n in pairs(cur_neighbor_disable_connected_check) do
        local found = false
        for _, n2 in pairs(new_neighbor_disable_connected_check) do
            if n == n2 then
                found = true
                break
            end
        end
        if not found then
            bgp.del_bgp_neighbor_disable_connected_check(as, n)
        end
    end
    for _, n in pairs(new_neighbor_disable_connected_check) do
        local found = false
        for _, n2 in pairs(cur_neighbor_disable_connected_check) do
            if n == n2 then
                found = true
                break
            end
        end
        if not found then
            bgp.add_bgp_neighbor_disable_connected_check(as, n)
        end
    end

end

function bgp.update_address_family(as, cur_address_family, new_address_family)
    if cur_address_family == nil and new_address_family == nil then
        return
    end
    if cur_address_family and not new_address_family then
        for _, af in pairs(cur_address_family) do
            bgp.del_address_family_part(as, af)
        end
    elseif not cur_address_family and new_address_family then
        for _, af in pairs(new_address_family) do   
            bgp.add_address_family_part(as, af)
        end
    elseif cur_address_family and new_address_family then
        bgp.compare_address_family(as, cur_address_family, new_address_family)
    end
end

function bgp.compare_address_family(as, cur_address_family, new_address_family)
    if cur_address_family == nil or new_address_family == nil then
        return
    end

    for _, af in pairs(new_address_family) do
        local found = false
        local family1 = string.format("%s %s", af.address_family, af.modifiler)
        for _, af2 in pairs(cur_address_family) do
            local family2 = string.format("%s %s", af2.address_family, af2.modifiler)
            if family1 == family2 then
                found = true
                -- update address_family
                bgp.compare_address_family_part(as, af2, af)
                break
            end
        end
        if not found then
            bgp.add_address_family_part(as, af)
        end
    end
    for _, af in pairs(cur_address_family) do
        local found = false
        local family1 = string.format("%s %s", af.address_family, af.modifiler)
        for _, af2 in pairs(new_address_family) do
            local family2 = string.format("%s %s", af2.address_family, af2.modifiler)
            if family1 == family2 then
                found = true
                break
            end
        end
        if not found then
            bgp.del_address_family_part(as, af)
        end
    end
end

function bgp.compare_address_family_part(as, cur_address_family, new_address_family)
    -- neighbor_route_map
    if cur_address_family.neighbor_route_map and not new_address_family.neighbor_route_map then
        for _, n in pairs(cur_address_family.neighbor_route_map) do
            bgp.del_bgp_address_family_neighbor_route_map(as, cur_address_family.address_family, cur_address_family.modifiler, n.neighbor, n.direction, n.route_map)
        end
    elseif not cur_address_family.neighbor_route_map and new_address_family.neighbor_route_map then
        for _, n in pairs(new_address_family.neighbor_route_map) do
            bgp.add_bgp_address_family_neighbor_route_map(as, cur_address_family.address_family, cur_address_family.modifiler, n.neighbor, n.direction, n.route_map)
        end
    elseif cur_address_family.neighbor_route_map and new_address_family.neighbor_route_map then
        bgp.compare_neighbor_route_map(as, cur_address_family, new_address_family, cur_address_family.neighbor_route_map, new_address_family.neighbor_route_map)
    end
    -- activate_address_family
    if cur_address_family.activate_address_family and not new_address_family.activate_address_family then
        for _, aa in pairs(cur_address_family.activate_address_family) do
            bgp.del_bgp_address_family_active(as, cur_address_family.address_family, cur_address_family.modifiler, aa)
        end
    elseif not cur_address_family.activate_address_family and new_address_family.activate_address_family then
        for _, aa in pairs(new_address_family.activate_address_family) do
            bgp.add_bgp_address_family_active(as, cur_address_family.address_family, cur_address_family.modifiler, aa)
        end
    elseif cur_address_family.activate_address_family and new_address_family.activate_address_family then
        bgp.compare_activate_address_family(as, cur_address_family.address_family, cur_address_family.modifiler, cur_address_family.activate_address_family, new_address_family.activate_address_family)
    end
    -- export_route
    if cur_address_family.export_route ~= new_address_family.export_route then
        bgp.set_bgp_address_family_export_route_status(as, cur_address_family.address_family, cur_address_family.modifiler, new_address_family.export_route)
    end
    -- import_route
    if cur_address_family.import_route ~= new_address_family.import_route then
        bgp.set_bgp_address_family_import_route_status(as, cur_address_family.address_family, cur_address_family.modifiler, new_address_family.import_route)
    end
    -- route_distinguisher
    if cur_address_family.route_distinguisher ~= new_address_family.route_distinguisher then
        bgp.del_bgp_address_family_route_distinguisher(as, cur_address_family.address_family, cur_address_family.modifiler, cur_address_family.route_distinguisher)
        bgp.add_bgp_address_family_route_distinguisher(as, cur_address_family.address_family, cur_address_family.modifiler, new_address_family.route_distinguisher)
    end
    -- route_target
    if cur_address_family.route_target ~= new_address_family.route_target then
        bgp.del_bgp_address_family_route_target(as, cur_address_family.address_family, cur_address_family.modifiler, cur_address_family.route_target)
        bgp.add_bgp_address_family_route_target(as, cur_address_family.address_family, cur_address_family.modifiler, new_address_family.route_target)
    end
    -- network
    if cur_address_family.network and not new_address_family.network then
        for _, n in pairs(cur_address_family.network) do
            bgp.del_bgp_address_family_network(as, cur_address_family.address_family, cur_address_family.modifiler, n)
        end
    elseif not cur_address_family.network and new_address_family.network then
        for _, n in pairs(new_address_family.network) do
            bgp.add_bgp_address_family_network(as, cur_address_family.address_family, cur_address_family.modifiler, n)
        end
    elseif cur_address_family.network and new_address_family.network then
        bgp.compare_network(as, cur_address_family.address_family, cur_address_family.modifiler, cur_address_family.network, new_address_family.network)
    end
    -- auto_assign_sid
    bgp.set_bgp_address_family_auto_assign_sid_status(as, cur_address_family.address_family, cur_address_family.modifiler, new_address_family.auto_assign_sid)
end

function bgp.compare_neighbor_route_map(as, cur_address_family, new_address_family, cur_neighbor_route_map, new_neighbor_route_map)
    for _, n in pairs(new_neighbor_route_map) do
        local found = false
        for _, n2 in pairs(cur_neighbor_route_map) do
            if n.neighbor == n2.neighbor and n.direction == n2.direction and n.route_map == n2.route_map then
                found = true
                break
            end
        end
        if not found then
            bgp.add_bgp_address_family_neighbor_route_map(as, cur_address_family.address_family, cur_address_family.modifiler, n.neighbor, n.direction, n.route_map)
        end
    end
    for _, n in pairs(cur_neighbor_route_map) do
        local found = false
        for _, n2 in pairs(new_neighbor_route_map) do
            if n.neighbor == n2.neighbor and n.direction == n2.direction and n.route_map == n2.route_map then
                found = true
                break
            end
        end
        if not found then
            bgp.del_bgp_address_family_neighbor_route_map(as, cur_address_family.address_family, cur_address_family.modifiler, n.neighbor, n.direction, n.route_map)
        end
    end

end

function bgp.compare_activate_address_family(as, address_family, modifiler, cur_activate_address_family, new_activate_address_family)
    for _, aa in pairs(new_activate_address_family) do
        local found = false
        for _, aa2 in pairs(cur_activate_address_family) do
            if aa == aa2 then
                found = true
                break
            end
        end
        if not found then
            bgp.add_bgp_address_family_active(as, address_family, modifiler, aa)
        end
    end
    for _, aa in pairs(cur_activate_address_family) do
        local found = false
        for _, aa2 in pairs(new_activate_address_family) do
            if aa == aa2 then
                found = true
                break
            end
        end
        if not found then
            bgp.del_bgp_address_family_active(as, address_family, modifiler, aa)
        end
    end
end

function bgp.compare_network(as, address_family, modifiler, cur_network, new_network)
    for _, n in pairs(new_network) do
        local found = false
        for _, n2 in pairs(cur_network) do
            if n == n2 then
                found = true
                break
            end
        end
        if not found then
            bgp.add_bgp_address_family_network(as, address_family, modifiler, n)
        end
    end
    for _, n in pairs(cur_network) do
        local found = false
        for _, n2 in pairs(new_network) do
            if n == n2 then
                found = true
                break
            end
        end
        if not found then
            bgp.del_bgp_address_family_network(as, address_family, modifiler, n)
        end
    end
end 



function bgp.add_bgp(bgp_as)
    if bgp_as == nil then
        return
    end
    local cmd = "router bgp"
    cmd = string.format("%s -c 'router bgp %s'", CLISH_CMD, bgp_as)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp(bgp_as)
    if bgp_as == nil then
        return
    end
    local cmd = "no router bgp"
    cmd = string.format("%s -c 'no router bgp %s'", CLISH_CMD, bgp_as)  
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_router_id(bgp_as, router_id)
    if bgp_as == nil or router_id == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'bgp router-id %s'", CLISH_CMD, bgp_as, router_id)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_router_id(bgp_as)
    if bgp_as == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'no bgp router-id'", CLISH_CMD, bgp_as)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.set_ebgp_require_policy(bgp_as, status)
    if bgp_as == nil or status == nil then
        return
    end
    if status == "disable" then
        cmd = string.format("%s -c 'router bgp %s' -c 'no bgp ebgp-requires-policy'", CLISH_CMD, bgp_as)
        local result = execute_command(cmd)
        print(cmd)
        return result
    else
        cmd = string.format("%s -c 'router bgp %s' -c 'bgp ebgp-requires-policy'", CLISH_CMD, bgp_as)
        local result = execute_command(cmd)
        print(cmd)
        return result
    end
end

function bgp.add_bgp_timer_KA_HA(bgp_as, KA, HA)
    if bgp_as == nil or KA == nil or HA == nil then
        return
    end
    local tmp_KA = KA
    local tmp_HA = HA
    if KA == nil and HA == nil then
        return
    end
    if KA == nil then
        tmp_HA = string.format("%i", tmp_HA)
        tmp_KA = tmp_HA * 3
    end
    if HA == nil then
        tmp_KA = string.format("%i", tmp_KA)
        tmp_HA = tmp_KA / 3
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'timer bgp %i %i'", CLISH_CMD, bgp_as, tmp_KA, tmp_HA)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_timer_KA_HA(bgp_as)
    if bgp_as == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'no timer bgp'", CLISH_CMD, bgp_as)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.set_bgp_fast_convergence(bgp_as, status)
    if bgp_as == nil or status == nil then
        return
    end
    local cmd = ""
    if status == "enable" then
        cmd = string.format("%s -c 'router bgp %s' -c 'bgp fast-convergence'", CLISH_CMD, bgp_as)
    else
        cmd = string.format("%s -c 'router bgp %s' -c 'no bgp fast-convergence'", CLISH_CMD, bgp_as)
    end
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_neighbor(bgp_as, neighbor_ip, neighbor_as)
    if bgp_as == nil or neighbor_ip == nil or neighbor_as == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'neighbor %s remote-as %i'", CLISH_CMD, bgp_as, neighbor_ip, neighbor_as)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_neighbor(bgp_as, neighbor_ip)
    if bgp_as == nil or neighbor_ip == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'no neighbor %s'", CLISH_CMD, bgp_as, neighbor_ip)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

-- PE–PE / RR 等多跳 eBGP：neighbor <ip> ebgp-multihop <ttl>
function bgp.add_bgp_neighbor_ebgp_multihop(bgp_as, neighbor_ip, hops)
    if bgp_as == nil or neighbor_ip == nil or hops == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'neighbor %s ebgp-multihop %i'", CLISH_CMD, bgp_as, neighbor_ip, hops)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_neighbor_ebgp_multihop(bgp_as, neighbor_ip)
    if bgp_as == nil or neighbor_ip == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'no neighbor %s ebgp-multihop'", CLISH_CMD, bgp_as, neighbor_ip)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_neighbor_disable_connected_check(bgp_as, neighbor_ip)
    if bgp_as == nil or neighbor_ip == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'neighbor disable-connected-check %s'", CLISH_CMD, bgp_as, neighbor_ip)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_neighbor_disable_connected_check(bgp_as, neighbor_ip)
    if bgp_as == nil or neighbor_ip == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'no neighbor disable-connected-check %s'", CLISH_CMD, bgp_as, neighbor_ip)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_address_family(bgp_as, address_family, modifiter)
    if bgp_as == nil or address_family == nil or modifiter == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s'", CLISH_CMD, bgp_as, address_family, modifiter)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_address_family_neighbor_route_map(bgp_as, address_family, modifiter, neighbor_ip, direction, route_map)
    if bgp_as == nil or address_family == nil or modifiter == nil or neighbor_ip == nil or direction == nil or route_map == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'neighbor %s %s route-map %s'", CLISH_CMD, bgp_as, address_family, modifiter, neighbor_ip, direction, route_map)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_address_family_neighbor_route_map(bgp_as, address_family, modifiter, neighbor_ip, direction, route_map)
    if bgp_as == nil or address_family == nil or modifiter == nil or neighbor_ip == nil or direction == nil or route_map == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no neighbor %s %s route-map %s'", CLISH_CMD, bgp_as, address_family, modifiter, neighbor_ip, direction, route_map)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.set_bgp_address_family_auto_assign_sid_status(bgp_as, address_family, modifiter, status)
    print(bgp_as, address_family, modifiter, status)
    if bgp_as == nil or address_family == nil or modifiter == nil then
        return
    end
 
    if status == "enable" then
        cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'sid vpn export auto'", CLISH_CMD, bgp_as, address_family, modifiter)
    else
        cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no sid vpn export auto'", CLISH_CMD, bgp_as, address_family, modifiter)
    end
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.set_bgp_address_family_export_route_status(bgp_as, address_family, modifiter, status)
    if bgp_as == nil or address_family == nil or modifiter == nil or status == nil then
        return
    end
    if status == "enable" then
        cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'export vpn'", CLISH_CMD, bgp_as, address_family, modifiter)
    else
        cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no export vpn'", CLISH_CMD, bgp_as, address_family, modifiter)
    end
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.set_bgp_address_family_import_route_status(bgp_as, address_family, modifiter, status)
    if bgp_as == nil or address_family == nil or modifiter == nil or status == nil then
        return
    end
    if status == "enable" then
        cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'import vpn'", CLISH_CMD, bgp_as, address_family, modifiter)
    else
        cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no import vpn'", CLISH_CMD, bgp_as, address_family, modifiter)
    end
    local result = execute_command(cmd)
    print(cmd)
    return result
end


function bgp.add_bgp_address_family_route_distinguisher(bgp_as, address_family, modifiter, route_distinguisher)
    if bgp_as == nil or address_family == nil or modifiter == nil or route_distinguisher == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'rd vpn export %s'", CLISH_CMD, bgp_as, address_family, modifiter, route_distinguisher)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_address_family_route_distinguisher(bgp_as, address_family, modifiter, route_distinguisher)
    if bgp_as == nil or address_family == nil or modifiter == nil or route_distinguisher == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no rd vpn export %s'", CLISH_CMD, bgp_as, address_family, modifiter, route_distinguisher)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_address_family_route_target(bgp_as, address_family, modifiter, route_target)
    if bgp_as == nil or address_family == nil or modifiter == nil or route_target == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'rt vpn both %s'", CLISH_CMD, bgp_as, address_family, modifiter, route_target)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_address_family_route_target(bgp_as, address_family, modifiter, route_target)
    if bgp_as == nil or address_family == nil or modifiter == nil or route_target == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no rt vpn both %s'", CLISH_CMD, bgp_as, address_family, modifiter, route_target)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_address_family_network(bgp_as, address_family, modifiter, network)
    if bgp_as == nil or address_family == nil or modifiter == nil or network == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'network %s'", CLISH_CMD, bgp_as, address_family, modifiter, network)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_address_family_network(bgp_as, address_family, modifiter, network)
    if bgp_as == nil or address_family == nil or modifiter == nil or network == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no network %s'", CLISH_CMD, bgp_as, address_family, modifiter, network)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_address_family_active(bgp_as, address_family, modifiter, neighbor_ip)
    if bgp_as == nil or address_family == nil or modifiter == nil or neighbor_ip == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'neighbor activate %s'", CLISH_CMD, bgp_as, address_family, modifiter, neighbor_ip)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_address_family_active(bgp_as, address_family, modifiter, neighbor_ip)
    if bgp_as == nil or address_family == nil or modifiter == nil or neighbor_ip == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'address-family %s %s' -c 'no neighbor activate %s'", CLISH_CMD, bgp_as, address_family, modifiter, neighbor_ip)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_segment_routing(bgp_as)
    if bgp_as == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'segment-routing srv6'", CLISH_CMD, bgp_as)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_segment_routing(bgp_as)
    if bgp_as == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'no segment-routing srv6'", CLISH_CMD, bgp_as)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.add_bgp_segment_routing_locator(bgp_as, locator)
    if bgp_as == nil or locator == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'segment-routing srv6' -c 'locator %s'", CLISH_CMD, bgp_as, locator)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

function bgp.del_bgp_segment_routing_locator(bgp_as, locator)
    if bgp_as == nil or locator == nil then
        return
    end
    local cmd = string.format("%s -c 'router bgp %s' -c 'segment-routing srv6' -c 'no locator %s'", CLISH_CMD, bgp_as, locator)
    local result = execute_command(cmd)
    print(cmd)
    return result
end

setmetatable(bgp, meta)
return bgp
