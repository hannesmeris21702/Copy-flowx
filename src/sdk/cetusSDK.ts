/**
 * Cetus Protocol SDK Configuration
 * Contains Cetus CLMM protocol constants and configurations
 */

/**
 * Cetus mainnet configuration
 * Source: Cetus documentation and deployed contracts
 */
export const CETUS_MAINNET_CONFIG = {
  // Cetus CLMM package ID
  packageId:
    "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb",
  
  // Global configuration object ID
  globalConfigId:
    "0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f",
  
  // Pools registry ID
  poolsId:
    "0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0",
  
  // Position NFT type
  positionNFTType:
    "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::position::Position",
};

/**
 * Get Cetus configuration for the current network
 * Currently only mainnet is supported
 */
export function getCetusConfig() {
  return CETUS_MAINNET_CONFIG;
}
