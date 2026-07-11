#!/usr/bin/env lua

package.path = package.path .. ";/rhos/etc/agent/tools/lua/?.lua"

local cli = {}
cli.vrf = require('vrf')
cli.interfaces = require('interfaces')
cli.ipv4_routes = require('ipv4_routes')
cli.ipv6_routes = require('ipv6_routes')
cli.ip_prefix_list = require('ip_prefix_list')
cli.segment_routing = require('segment-routing')
cli.route_map = require('route_map')
cli.bgp = require('bgp')
cli.vrrp = require('vrrp')
cli.ipsec = require('ipsec')
cli.acl = require('acl')
return cli
