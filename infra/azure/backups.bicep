@description('Unique storage account for bounded private daily backups.')
param backupAccount string
param vmPrincipalId string
param location string = 'centralindia'

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: backupAccount
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  tags: { application: 'voqro', purpose: 'private-backups' }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    isVersioningEnabled: false
  }
}
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'backups'
  properties: { publicAccess: 'None' }
}
resource retention 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [{
        name: 'expire-daily-snapshots'
        enabled: true
        type: 'Lifecycle'
        definition: {
          filters: { blobTypes: ['blockBlob'], prefixMatch: ['backups/daily/'] }
          actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 7 } } }
        }
      }]
    }
  }
}
resource backupAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: container
  name: guid(container.id, vmPrincipalId, 'voqro-backup-access')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: vmPrincipalId
    principalType: 'ServicePrincipal'
  }
}
output accountName string = account.name
output containerName string = container.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
