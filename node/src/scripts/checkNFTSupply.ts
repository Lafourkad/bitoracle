import { JSONRpcProvider, getContract } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { ABIDataTypes, BitcoinAbiTypes } from 'opnet';
import type { BitcoinInterfaceAbi, FunctionBaseData } from 'opnet';

const fn = (e: FunctionBaseData): FunctionBaseData => e;

const ABI: BitcoinInterfaceAbi = [
    fn({ name: 'totalSupply', type: BitcoinAbiTypes.Function, constant: true, inputs: [], outputs: [{ name: 'totalSupply', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'balanceOf', type: BitcoinAbiTypes.Function, constant: true, inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }] }),
];

const NFT = 'opt1sqp6hhz27htlr9jcegw29zz52f2rj4nh4yuz69m27';
const NETWORK = (networks as any).opnetTestnet;
const provider = new JSONRpcProvider('https://testnet.opnet.org', NETWORK);

async function main() {
    const contract = getContract(NFT, ABI, provider, NETWORK);
    const supply = await (contract as any).totalSupply();
    console.log('totalSupply:', supply.properties);
    console.log('revert:', supply.revert);
    console.log('events:', supply.events?.length);
}

main().catch(console.error);
