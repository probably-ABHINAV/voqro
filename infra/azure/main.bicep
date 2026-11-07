// Infrastructure only. No application credentials or billing-plan changes.
targetScope = 'resourceGroup'

@description('Use an Indian region only after checking subscription policy and VM quota.')
param location string = 'centralindia'

@description('Keep a unique short prefix for this isolated application resource group.')
@minLength(3)
@maxLength(20)
param namePrefix string = 'voqro'

@description('Nonzonal B2ats_v2 is the current Students candidate: 2 vCPU/1 GiB with a 2 GiB OS swap file. Verify quota and workload capacity.')
@allowed(['Standard_B1s', 'Standard_B1ms', 'Standard_B2s', 'Standard_B2ats_v2'])
param vmSize string = 'Standard_B2ats_v2'

@description('Public DNS label in the chosen Azure region. Must be globally unique in that region.')
param dnsLabel string

@description('Public SSH key required by Linux VM provisioning. Port 22 remains closed.')
param sshPublicKey string

@description('Non-root OS administration account. Operate through Azure VM Run Command.')
param adminUsername string = 'voqroadmin'

@description('Persistent ext4 data disk size. These disks may consume student credit even when VM compute is free.')
@allowed([32, 64, 128])
param dataDiskSizeGB int = 32

var tags = { application: 'voqro', purpose: 'student-mvp' }

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${namePrefix}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'PublicHTTPS'
        properties: { priority: 100, access: 'Allow', direction: 'Inbound', protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '443', sourceAddressPrefix: 'Internet', destinationAddressPrefix: '*' }
      }
      {
        name: 'CertificateValidationHTTP'
        properties: { priority: 110, access: 'Allow', direction: 'Inbound', protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '80', sourceAddressPrefix: 'Internet', destinationAddressPrefix: '*' }
      }
      {
        name: 'DenyDirectApplicationAndSSH'
        properties: { priority: 120, access: 'Deny', direction: 'Inbound', protocol: 'Tcp', sourcePortRange: '*', destinationPortRanges: ['22', '3000'], sourceAddressPrefix: '*', destinationAddressPrefix: '*' }
      }
    ]
  }
}
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.67.0.0/24'] }
    subnets: [{ name: 'backend', properties: { addressPrefix: '10.67.0.0/24', networkSecurityGroup: { id: nsg.id } } }]
  }
}
resource publicIP 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${namePrefix}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${namePrefix}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [{ name: 'primary', properties: { privateIPAllocationMethod: 'Dynamic', subnet: { id: '${vnet.id}/subnets/backend' }, publicIPAddress: { id: publicIP.id } } }]
  }
}
resource disk 'Microsoft.Compute/disks@2024-03-02' = {
  name: '${namePrefix}-data'
  location: location
  tags: tags
  sku: { name: 'StandardSSD_LRS' }
  properties: { creationData: { createOption: 'Empty' }, diskSizeGB: dataDiskSizeGB }
}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${namePrefix}-vm'
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: '${namePrefix}-vm'
      adminUsername: adminUsername
      customData: base64(loadTextContent('cloud-init.yaml'))
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: { publicKeys: [{ path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: sshPublicKey }] }
      }
    }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' }
      osDisk: { name: '${namePrefix}-os', createOption: 'FromImage', deleteOption: 'Delete', caching: 'ReadWrite', diskSizeGB: 32, managedDisk: { storageAccountType: 'StandardSSD_LRS' } }
      dataDisks: [{ name: disk.name, lun: 0, createOption: 'Attach', deleteOption: 'Detach', caching: 'None', managedDisk: { id: disk.id } }]
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { primary: true, deleteOption: 'Delete' } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}
output vmName string = vm.name
output backendHostname string = publicIP.properties.dnsSettings.fqdn
output backendOrigin string = 'https://${publicIP.properties.dnsSettings.fqdn}'
output persistentDiskName string = disk.name
