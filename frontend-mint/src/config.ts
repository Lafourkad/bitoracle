import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider } from 'opnet';

export const NFT_ADDRESS      = 'opt1sqzchetuzymeewfkj8et2hvm2pkjg2ctpksm3mtun';
export const REGISTRY_ADDRESS = 'opt1sqp0ce6tqqk3z4wwajgzufdm4vrwf234zjunljqkn';
export const PRICEFEED_ADDRESS = 'opt1sqr8d8dfjjxp6v9gk60fl8snk0fy7fwhe45cpj6va';
export const MAX_SUPPLY    = 100;
export const MINT_PRICE    = 5_000;
export const OPNET_NETWORK = (networks as any).opnetTestnet;
export const PROVIDER      = new JSONRpcProvider('https://testnet.opnet.org', OPNET_NETWORK);
