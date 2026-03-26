/**
 * Oracle node configuration — loaded from env vars
 */

export type Network = 'mainnet' | 'testnet' | 'regtest';

export interface OracleConfig {
    // Identity
    nodeId: string;            // e.g. 'node1', 'node2', 'node3'
    network: Network;
    schnorrPrivWIF: string;    // WIF — Schnorr key for MuSig2
    quantumPrivHex: string;    // hex — ML-DSA key

    // Assets to track
    assets: string[];          // e.g. ['BTC/USD']

    // Price sources
    priceSources: PriceSourceConfig[];

    // P2P network
    p2p: P2PConfig;

    // OpNet
    opnet: OpNetConfig;

    // Oracle behavior
    deviationThreshold: number;   // % price change that triggers submission (e.g. 0.5)
    heartbeatBlocks: number;      // max blocks between submissions (e.g. 6)
    minQuorum: number;            // min oracles needed to aggregate (e.g. 3)

    // HTTP API
    apiPort?: number;
}

export interface PriceSourceConfig {
    name: string;
    type: 'binance' | 'coinbase' | 'kraken' | 'custom';
    url?: string;
    weight: number;
}

export interface P2PConfig {
    listenPort: number;           // e.g. 7771, 7772, 7773
    listenAddresses: string[];
    bootstrapPeers: string[];
    topic: string;
}

export interface OpNetConfig {
    rpcUrl: string;
    registryContractAddress: string;
    priceFeedContractAddress: string;
    nftContractAddress: string;
}

export async function loadConfig(): Promise<OracleConfig> {
    const nodeId = process.env.NODE_ID ?? 'node1';
    const p2pPort = parseInt(process.env.P2P_PORT ?? '7771');

    // Bootstrap: chaque nœud connaît les autres
    const bootstrapPeers: string[] = (process.env.BOOTSTRAP_PEERS ?? '').split(',').filter(Boolean);

    return {
        nodeId,
        network: (process.env.NETWORK ?? 'testnet') as Network,
        schnorrPrivWIF:  process.env.SCHNORR_PRIV_WIF  ?? '',
        quantumPrivHex:  process.env.QUANTUM_PRIV_HEX  ?? '',
        assets: (process.env.ASSETS ?? 'BTC/USD').split(','),
        priceSources: [
            { name: 'binance',  type: 'binance',  weight: 1 },
            { name: 'coinbase', type: 'coinbase', weight: 1 },
            { name: 'kraken',   type: 'kraken',   weight: 1 },
        ],
        p2p: {
            listenPort: p2pPort,
            listenAddresses: [`/ip4/0.0.0.0/tcp/${p2pPort}`],
            bootstrapPeers,
            topic: 'btc-oracle/prices/v1',
        },
        opnet: {
            rpcUrl: process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org',
            registryContractAddress: process.env.REGISTRY_CONTRACT ?? '',
            priceFeedContractAddress: process.env.PRICEFEED_CONTRACT ?? '',
            nftContractAddress: process.env.NFT_CONTRACT ?? '',
        },
        deviationThreshold: parseFloat(process.env.DEVIATION    ?? '0.5'),
        heartbeatBlocks:    parseInt(process.env.HEARTBEAT       ?? '6'),
        minQuorum:          parseInt(process.env.MIN_QUORUM      ?? '3'),
        apiPort:            parseInt(process.env.API_PORT        ?? '8080'),
    };
}
