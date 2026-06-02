{
    "configured": true,
    "apiKeyConfigured": true,
    "apiVersion": "1.2.0",
    "onlyFirstAswCtl": false,
    "items": [
        {
            "id": "0:10.21.0.1",
            "name": "HSM",
            "baseUrl": "https://10.21.180.180",
            "health": "",
            "healthPath": "/healthz",
            "healthNotApplicable": false,
            "info": {
                "ok": true,
                "api_version": "1.2.0",
                "host": "10.21.0.1",
                "ssh_port": 22,
                "device_profile": "h3c-huawei-like",
                "info_commands": [
                    "display version",
                    "display current-configuration"
                ],
                "lines": [
                    {
                        "command": "display version",
                        "ok": true,
                        "stdout": "\r\r\n\u0000******************************************************************************\r\r\n* Copyright (c) 2004-2019 New H3C Technologies Co., Ltd. All rights reserved.*\r\r\n* Without the owner's prior written consent,                                 *\r\r\n* no decompiling or reverse-engineering shall be allowed.                    *\r\r\n******************************************************************************\r\r\n\r\r\n\u0000<H3C-CORE-SW>screen-length 0 temporary\r\r\n                           ^\r\r\n % Unrecognized command found at '^' position.\r\r\n<H3C-CORE-SW>display version\r\r\n",
                        "stderr": ""
                    },
                    {
                        "command": "display current-configuration",
                        "ok": false,
                        "stdout": "\r\r\n\u0000******************************************************************************\r\r\n* Copyright (c) 2004-2019 New H3C Technologies Co., Ltd. All rights reserved.*\r\r\n* Without the owner's prior written consent,                                 *\r\r\n* no decompiling or reverse-engineering shall be allowed.                    *\r\r\n******************************************************************************\r\r\n\r\r\n\u0000<H3C-CORE-SW>screen-length 0 temporary\r\r\n                           ^\r\r\n % Unrecognized command found at '^' position.\r\r\n<H3C-CORE-SW>display current-configurati\r\r\non\r\r\n#\r\r\n version 7.1.070, Release 2612P06\r\r\n#\r\r\n sysname H3C-CORE-SW\r\r\n#\r\r\n clock timezone Beijing add 08:00:00\r\r\n clock protocol ntp\r\r\n#\r\r\n irf mac-address persistent timer\r\r\n irf auto-update enable\r\r\n undo irf link-delay\r\r\n irf member 1 priority 1\r\r\n#\r\r\n service-loopback group 1 type tunnel\r\r\n#\r\r\n dhcp enable\r\r\n#\r\r\n mirroring-group 1 local\r\r\n#\r\r\n lldp global enable\r\r\n#\r\r\n system-working-mode standard\r\r\n hardware-resource switch-mode 0\r\r\n---- More ----\r\r               \r<H3C-CORE-SW>quit\r\r\n",
                        "stderr": "",
                        "error": "ssh command timeout after 15s"
                    }
                ],
                "notice": "instances[] 按交换机维度；单台时仍返回顶层 host/lines 兼容旧客户端；每台至少一条命令 SSH 成功则该实例 ok=true"
            },
            "interfaces": {
                "ok": true,
                "api_version": "1.2.0",
                "host": "10.21.0.1",
                "ssh_port": 22,
                "device_profile": "h3c-huawei-like",
                "interface_commands": [
                    "display interface brief"
                ],
                "lines": [
                    {
                        "command": "display interface brief",
                        "ok": true,
                        "stdout": "\r\r\n\u0000******************************************************************************\r\r\n* Copyright (c) 2004-2019 New H3C Technologies Co., Ltd. All rights reserved.*\r\r\n* Without the owner's prior written consent,                                 *\r\r\n* no decompiling or reverse-engineering shall be allowed.                    *\r\r\n******************************************************************************\r\r\n\r\r\n\u0000<H3C-CORE-SW>screen-length 0 temporary\r\r\n                           ^\r\r\n % Unrecognized command found at '^' position.\r\r\n<H3C-CORE-SW>display interface brief\r\r\n",
                        "stderr": ""
                    }
                ],
                "notice": "instances[] 按交换机维度；单台时仍返回顶层 host/lines 兼容旧客户端"
            },
            "performance": {
                "ok": true,
                "api_version": "1.2.0",
                "host": "10.21.0.1",
                "ssh_port": 22,
                "device_profile": "h3c-huawei-like",
                "performance_commands": [
                    "display cpu-usage",
                    "display memory"
                ],
                "lines": [
                    {
                        "command": "display cpu-usage",
                        "ok": true,
                        "stdout": "\r\r\n\u0000******************************************************************************\r\r\n* Copyright (c) 2004-2019 New H3C Technologies Co., Ltd. All rights reserved.*\r\r\n* Without the owner's prior written consent,                                 *\r\r\n* no decompiling or reverse-engineering shall be allowed.                    *\r\r\n******************************************************************************\r\r\n\r\r\n\u0000<H3C-CORE-SW>screen-length 0 temporary\r\r\n                           ^\r\r\n % Unrecognized command found at '^' position.\r\r\n<H3C-CORE-SW>display cpu-usage\r\r\nSlot 1 CPU 0 CPU usage:\r\r\n      30% in last 5 seconds\r\r\n      19% in last 1 minute\r\r\n      12% in last 5 minutes\r\r\n\r\r\n<H3C-CORE-SW>quit\r\r\n",
                        "stderr": ""
                    },
                    {
                        "command": "display memory",
                        "ok": true,
                        "stdout": "\r\r\n\u0000******************************************************************************\r\r\n* Copyright (c) 2004-2019 New H3C Technologies Co., Ltd. All rights reserved.*\r\r\n* Without the owner's prior written consent,                                 *\r\r\n* no decompiling or reverse-engineering shall be allowed.                    *\r\r\n******************************************************************************\r\r\n\r\r\n\u0000<H3C-CORE-SW>screen-length 0 temporary\r\r\n                           ^\r\r\n % Unrecognized command found at '^' position.\r\r\n<H3C-CORE-SW>display memory\r\r\nMemory statistics are measured in KB:\r\r\nSlot 1: \r\r\n             Total      Used      Free    Shared   Buffers    Cached   FreeRatio\r\r\nMem:       2024320   1335648    688672         0      2480    297952       34.6%\r\r\n-/+ Buffers/Cache:   1035216    989104\r\r\nSwap:            0         0         0\r\r\n\r\r\n<H3C-CORE-SW>quit\r\r\n",
                        "stderr": ""
                    }
                ],
                "notice": "instances[] 按交换机维度；单台时仍返回顶层 host/lines 兼容旧客户端"
            },
            "performanceNotApplicable": false,
            "deviceProfiles": null,
            "vlans": {
                "ok": true,
                "api_version": "1.2.0",
                "host": "10.21.0.1",
                "ssh_port": 22,
                "device_profile": "h3c-huawei-like",
                "vlan_commands": [
                    "display vlan"
                ],
                "lines": [
                    {
                        "command": "display vlan",
                        "ok": true,
                        "stdout": "\r\r\n\u0000******************************************************************************\r\r\n* Copyright (c) 2004-2019 New H3C Technologies Co., Ltd. All rights reserved.*\r\r\n* Without the owner's prior written consent,                                 *\r\r\n* no decompiling or reverse-engineering shall be allowed.                    *\r\r\n******************************************************************************\r\r\n\r\r\n\u0000<H3C-CORE-SW>screen-length 0 temporary\r\r\n                           ^\r\r\n % Unrecognized command found at '^' position.\r\r\n<H3C-CORE-SW>display vlan\r\r\n Total VLANs: 47\r\r\n The VLANs include:\r\r\n 1(default), 2-3, 8-15, 20, 100, 103-104, 113, 172, 231-235, 303, 500-504, \b\b \r\r\n 520, 600, 700, 2828, 2831, 2835-2841, 2890-2891, 2893, 2895-2897, 4094, \b\b \r\r\r\n<H3C-CORE-SW>quit\r\r\n",
                        "stderr": ""
                    }
                ],
                "notice": "instances[] 按交换机维度；单台时仍返回顶层 host/lines 兼容旧客户端"
            },
            "vlansNotApplicable": false,
            "apiKeySent": true
        }
    ],
    "source": "live",
    "stale": false,
    "cacheSyncedAt": "2026-06-02T07:00:40.826Z",
    "persisted": true
}