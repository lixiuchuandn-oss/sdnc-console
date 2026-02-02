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

async function run() {
    try {
        // 1. Find the target VPC
        const vpcUid = '593682de-8f08-4d76-92b8-de2fd849c672';
        const vpcUrl = `${origin}/apis/kubeovn.io/v1/vpcs`;
        
        console.log(`Fetching VPCs...`);
        const vpcRes = await axios.get(vpcUrl, {
            headers: { Authorization: `Bearer ${cloud.token}` },
            httpsAgent: agent
        });
        
        const targetVpc = vpcRes.data.items.find(v => v.metadata.uid === vpcUid);
        if (!targetVpc) {
            console.error(`Target VPC with UID ${vpcUid} not found!`);
            return;
        }
        console.log(`Found Target VPC: ${targetVpc.metadata.name}`);

        // 2. Define Subnet and NAD details
        const subnetName = 'subnet-private-1';
        const namespace = 'default';
        const cidr = '10.0.1.0/24';
        const gateway = '10.0.1.1';
        const provider = `${subnetName}.${namespace}.ovn`;

        // 3. Create NetworkAttachmentDefinition (NAD)
        // Required for Harvester validation and Multus usage
        const nadUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${namespace}/network-attachment-definitions`;
        const nadPayload = {
            apiVersion: "k8s.cni.cncf.io/v1",
            kind: "NetworkAttachmentDefinition",
            metadata: {
                name: subnetName,
                namespace: namespace
            },
            spec: {
                config: JSON.stringify({
                    cniVersion: "0.3.1",
                    name: subnetName,
                    type: "kube-ovn",
                    server_socket: "/run/openvswitch/kube-ovn-daemon.sock",
                    provider: provider
                })
            }
        };

        console.log(`Creating NAD: ${subnetName}...`);
        try {
            await axios.post(nadUrl, nadPayload, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            console.log('NAD created successfully.');
        } catch (e) {
            if (e.response && e.response.status === 409) {
                console.log('NAD already exists.');
            } else {
                throw new Error(`Failed to create NAD: ${e.message}`);
            }
        }

        // 4. Create Subnet
        const subnetUrl = `${origin}/apis/kubeovn.io/v1/subnets`;
        const subnetPayload = {
            apiVersion: 'kubeovn.io/v1',
            kind: 'Subnet',
            metadata: {
                name: subnetName
            },
            spec: {
                vpc: targetVpc.metadata.name,
                cidrBlock: cidr,
                gateway: gateway,
                protocol: "IPv4",
                nat: true,
                enableDhcp: true,
                provider: provider
            }
        };

        console.log(`Creating Subnet: ${subnetName}...`);
        try {
            const res = await axios.post(subnetUrl, subnetPayload, {
                headers: { Authorization: `Bearer ${cloud.token}` },
                httpsAgent: agent
            });
            console.log(`Subnet created successfully! UID: ${res.data.metadata.uid}`);
            console.log(`Provider: ${res.data.spec.provider}`);
        } catch (e) {
            if (e.response && e.response.status === 409) {
                console.log('Subnet already exists.');
            } else {
                console.error(`Failed to create Subnet:`);
                if (e.response && e.response.data) {
                    console.error(JSON.stringify(e.response.data, null, 2));
                } else {
                    console.error(e.message);
                }
            }
        }

    } catch (e) {
        console.error('Unexpected Error:', e.message);
    }
}

run();
