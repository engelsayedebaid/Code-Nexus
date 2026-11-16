import brand from './app-brand.json'

// Carver keeps Orca Nexus's install/data identity so an approved release can upgrade it in
// place. The distinct protocol and disabled updater keep stock Orca untouched.
export const APP_BRAND = {
  productName: brand.productName,
  appId: brand.appId,
  exeName: brand.exeName,
  exeFileName: `${brand.exeName}.exe`,
  cliCommandName: brand.cliCommandName,
  artifactName: brand.artifactName,
  protocolScheme: brand.protocolScheme,
  userDataName: brand.userDataName,
  description: brand.description,
  selfUpdateDisabled: brand.selfUpdate === 'disabled',
  icon: brand.icon
} as const

export const APP_BRAND_NAME = APP_BRAND.productName
export const APP_BRAND_APP_ID = APP_BRAND.appId
export const APP_BRAND_PROTOCOL_SCHEME = APP_BRAND.protocolScheme
export const APP_BRAND_USER_DATA_NAME = APP_BRAND.userDataName

// Links this build generates use its own scheme; parsers accept stock orca:// too so links shared
// between the two apps still resolve.
export const APP_LINK_SCHEMES = [...new Set(['orca', APP_BRAND.protocolScheme])] as const
