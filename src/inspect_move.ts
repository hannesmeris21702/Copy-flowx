import { SuiClient } from '@mysten/sui/client';
import { initMainnetSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';

async function inspectClosePositionFunction() {
  const rpcUrl = 'https://fullnode.mainnet.sui.io:443';
  const client = new SuiClient({ url: rpcUrl });
  
  // Initialize SDK to get the package ID
  const sdk = initMainnetSDK(rpcUrl, '0x0000000000000000000000000000000000000000000000000000000000000000');
  const packageId = sdk.sdkOptions.integrate.published_at;
  
  console.log(`Package ID: ${packageId}`);
  console.log('\nFetching normalized module...\n');
  
  try {
    // Get the normalized module for pool_script
    const normalizedModule = await client.getNormalizedMoveModule({
      package: packageId,
      module: 'pool_script'
    });
    
    // Find close_position function
    const closePositionFunc = normalizedModule.exposedFunctions['close_position'];
    
    if (closePositionFunc) {
      console.log('=== close_position Function Signature ===');
      console.log('\nFunction name:', 'close_position');
      console.log('\nVisibility:', closePositionFunc.visibility);
      console.log('\nIs entry:', closePositionFunc.isEntry);
      console.log('\nType parameters:', JSON.stringify(closePositionFunc.typeParameters, null, 2));
      console.log('\nParameters:');
      closePositionFunc.parameters.forEach((param: any, idx: number) => {
        console.log(`  ${idx + 1}. ${JSON.stringify(param, null, 2)}`);
      });
      console.log('\nReturn type:', JSON.stringify(closePositionFunc.return, null, 2));
    } else {
      console.log('close_position function not found in pool_script module');
    }
  } catch (error) {
    console.error('Error fetching module:', error);
  }
}

inspectClosePositionFunction();
