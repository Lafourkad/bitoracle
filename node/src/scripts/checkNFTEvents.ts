import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

const NFT_ADDRESS = 'opt1sqp6hhz27htlr9jcegw29zz52f2rj4nh4yuz69m27';
const provider = new JSONRpcProvider('https://testnet.opnet.org', (networks as any).opnetTestnet);

async function main() {
    const latest = await provider.getBlockNumber();
    console.log('Latest block:', latest);

    const txs = await (provider as any).getTransactionsByAddress(NFT_ADDRESS).catch((e: any) => {
        console.log('getTransactionsByAddress err:', e.message);
        return null;
    });
    if (txs) console.log('Txs:', JSON.stringify(txs?.slice(0,5), null, 2));

    // Tenter via getContractEvents
    const events = await (provider as any).getContractEvents({
        address: NFT_ADDRESS,
        fromBlock: latest - 100,
        toBlock: latest,
    }).catch((e: any) => {
        console.log('getContractEvents err:', e.message);
        return null;
    });
    if (events) console.log('Events:', JSON.stringify(events?.slice(0,10), null, 2));
}

main().catch(console.error);
