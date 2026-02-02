const axios = require('axios');
const https = require('https');

const cloud = {
    name: '新建云',
    endpoint: 'https://172.16.3.79/v3',
    token: 'token-jlbx8:7w9fjxfrrbp24895dnfm6fltwt666ppqsxsnd5jj5m8crwzcd69f5x',
    insecure: true
};

const agent = new https.Agent({  
  rejectUnauthorized: !cloud.insecure
});

// Normalize endpoint to origin
let origin = cloud.endpoint.replace(/\/+$/, '');
try {
    const u = new URL(origin);
    origin = `${u.protocol}//${u.host}`;
} catch (e) {
    origin = origin.replace(/\/v[0-9].*$/, '');
}

console.log(`Origin: ${origin}`);

async function run() {
    try {
        // 1. List VPCs
        const vpcUrl = `${origin}/apis/kubeovn.io/v1/vpcs`;
        console.log(`Listing VPCs from ${vpcUrl}...`);
        
        const res = await axios.get(vpcUrl, {
            headers: { Authorization: `Bearer ${cloud.token}` },
            httpsAgent: agent
        });
        
        const items = res.data.items || [];
        console.log(`Found ${items.length} VPCs.`);
        const vpcUid = '593682de-8f08-4d76-92b8-de2fd849c672';
        const targetVpc = items.find(v => v.metadata.uid === vpcUid);
        
        if (!targetVpc) {
            console.log('Target VPC not found in this cloud.');
            return;
        }
        
        console.log(`Found VPC: ${targetVpc.metadata.name} (${targetVpc.metadata.uid})`);
        
        // 1.5 List API Groups to find Harvester networks
        const apisUrl = `${origin}/apis`;
        const apisRes = await axios.get(apisUrl, {
            headers: { Authorization: `Bearer ${cloud.token}` },
            httpsAgent: agent
        });
        const groups = apisRes.data.groups.map(g => g.name);
        console.log("API Groups:", groups.filter(g => g.includes('harvester')));

        // List resources in network.harvesterhci.io/v1beta1
        const netUrl = `${origin}/apis/network.harvesterhci.io/v1beta1`;
        console.log(`Listing resources from ${netUrl}...`);
        try {
            const netRes = await axios.get(netUrl, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            console.log("Resources:", netRes.data.resources.map(r => r.name));
        } catch (e) {
            console.log("Failed to list network resources:", e.message);
        }

        // 1.8 List Network Attachment Definitions (NADs) - INSPECT DETAILS
        try {
            const nadUrl = `${origin}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions`;
            const res = await axios.get(nadUrl, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            console.log(`\nFound ${res.data.items.length} NADs:`);
            res.data.items.forEach(item => {
                console.log(`- ${item.metadata.name} (${item.metadata.namespace})`);
                // Print annotations and config for inspection
                console.log(`  Annotations:`, item.metadata.annotations);
                console.log(`  Config:`, item.spec.config);
            });
        } catch (e) {
            console.log("Failed to list NADs:", e.message);
        }

        // 1.8 List Existing Subnets
        const subnetsUrl = `${origin}/apis/kubeovn.io/v1/subnets`;
        console.log(`Listing Subnets from ${subnetsUrl}...`);
        try {
            const subRes = await axios.get(subnetsUrl, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            console.log(`Found ${subRes.data.items.length} Subnets:`);
            subRes.data.items.forEach(s => {
                console.log(` - ${s.metadata.name}: provider="${s.spec.provider}"`);
                if (s.metadata.name === 'ovn-default') {
                    console.log('ovn-default JSON:', JSON.stringify(s, null, 2));
                }
            });
        } catch (e) {
            console.log("Failed to list subnets:", e.message);
        }

        // List VlanConfigs
        const vcUrl = `${origin}/apis/network.harvesterhci.io/v1beta1/vlanconfigs`;
        console.log(`Listing VlanConfigs from ${vcUrl}...`);
        try {
            const vcRes = await axios.get(vcUrl, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            vcRes.data.items.forEach(vc => console.log(` - ${vc.metadata.name}`));
        } catch (e) {
            console.log("Failed to list VlanConfigs:", e.message);
        }

        // 1.9 Create Dummy NAD for Testing
        const nadName = 'test-net';
        const nadNamespace = 'default';
        const nadCreateUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions`;
        
        const nadPayload = {
            apiVersion: "k8s.cni.cncf.io/v1",
            kind: "NetworkAttachmentDefinition",
            metadata: {
                name: nadName,
                namespace: nadNamespace
            },
            spec: {
                config: JSON.stringify({
                    cniVersion: "0.3.1",
                    name: nadName,
                    type: "kube-ovn",
                    server_socket: "/run/openvswitch/kube-ovn-daemon.sock",
                    provider: `${nadName}.${nadNamespace}.ovn`
                })
            }
        };

        console.log(`Creating NAD ${nadName}...`);
        try {
            await axios.post(nadCreateUrl, nadPayload, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            console.log("NAD created successfully.");
        } catch (e) {
            console.log("Failed to create NAD (might exist):", e.message);
        }

        // 2. Create Subnet Tests
        const createUrl = `${origin}/apis/kubeovn.io/v1/subnets`;
        const providersToTest = [`${nadName}.${nadNamespace}.ovn`];

        for (const provider of providersToTest) {
            // Test provider logic continues below

        // Cleanup NAD
        /*
        console.log(`Deleting NAD ${nadName}...`);
        try {
            await axios.delete(`${nadCreateUrl}/${nadName}`, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
        } catch (e) {
            console.log("Failed to delete NAD:", e.message);
        }
        */
            console.log(`\nTesting provider: "${provider}"`);
            const payload = {
                apiVersion: 'kubeovn.io/v1',
                kind: 'Subnet',
                metadata: {
                    name: `test-ai-${provider.replace(/[\/\.]/g, '-')}`
                },
                spec: {
                    vpc: targetVpc.metadata.name,
                    cidrBlock: "10.0.1.0/24",
                    gateway: "10.0.1.1",
                    protocol: "IPv4",
                    nat: true,
                    enableDhcp: true,
                    provider: provider
                }
            };

            try {
                await axios.post(createUrl, payload, {
                    headers: { Authorization: `Bearer ${cloud.token}` },
                    httpsAgent: agent
                });
                console.log(`SUCCESS with provider: ${provider}`);
                // Cleanup
                await axios.delete(`${createUrl}/${payload.metadata.name}`, {
                    headers: { Authorization: `Bearer ${cloud.token}` },
                    httpsAgent: agent
                });
            } catch (e) {
                console.log(`FAILED with provider: ${provider}`);
                if (e.response && e.response.data) {
                     console.log(`Reason: ${e.response.data.message}`);
                } else {
                    console.log(e.message);
                }
            }
        }
        
    } catch (e) {
        console.error('ERROR:', e.message);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', JSON.stringify(e.response.data, null, 2));
        }
    }
}

/*
        // List ClusterNetworks
        const cnUrl = `${origin}/apis/network.harvesterhci.io/v1beta1/clusternetworks`;
        console.log(`Listing ClusterNetworks from ${cnUrl}...`);
        const cnRes = await axios.get(cnUrl, {
            headers: { Authorization: `Bearer ${cloud.token}` },
            httpsAgent: agent
        });
        cnRes.data.items.forEach(cn => console.log(` - ${cn.metadata.name}: ${JSON.stringify(cn.spec)}`));
        } catch (e) {
            console.log("Failed to list network resources:", e.message);
        }

        // 2. Create Subnet
        const subnetName = 'test-ai-direct';
        const createUrl = `${origin}/apis/kubeovn.io/v1/subnets`;
        
        const payload = {
            apiVersion: 'kubeovn.io/v1',
            kind: 'Subnet',
            metadata: {
                name: subnetName
            },
            spec: {
                vpc: targetVpc.metadata.name, // "ovn-cluster"
                cidrBlock: "10.0.1.0/24",
                gateway: "10.0.1.1",
                protocol: "IPv4",
                nat: true,
                enableDhcp: true
                // provider removed
            }
        };
        
        console.log('Creating subnet with payload:', JSON.stringify(payload, null, 2));
        
        const createRes = await axios.post(createUrl, payload, {
            headers: { Authorization: `Bearer ${cloud.token}` },
            httpsAgent: agent
        });
        
        console.log('SUCCESS:', createRes.status);
        console.log(JSON.stringify(createRes.data, null, 2));
        
        // Cleanup
        console.log('Cleaning up...');
        await axios.delete(`${createUrl}/${subnetName}`, {
            headers: { Authorization: `Bearer ${cloud.token}` },
            httpsAgent: agent
        });
        console.log('Deleted test subnet.');
        
    } catch (e) {
        console.error('ERROR:', e.message);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', JSON.stringify(e.response.data, null, 2));
        }
    }
}
*/
run();
