/**
 * Core types for the oracle network
 */

// A signed price attestation from one oracle
export interface PriceAttestation {
    asset: string;           // e.g. 'BTC/USD'
    price: bigint;           // price in satoshis or USD cents (integer, no floats)
    blockNumber: bigint;     // Bitcoin block height at time of observation
    oracleAddress: string;   // hex — oracle's OpNet address
    signature: Uint8Array;   // Schnorr sig over sha256(asset || price || blockNumber)
    timestamp: number;       // unix ms — for local ordering only, NOT used on-chain
}

// Aggregated price after quorum
export interface AggregatedPrice {
    asset: string;
    price: bigint;           // median of all valid attestations
    blockNumber: bigint;
    attestations: PriceAttestation[];
    leaderAddress: string;   // who submitted this round
    thresholdSig?: Uint8Array; // collective ML-DSA signature (set after threshold rounds)
}

// Oracle status as tracked locally
export interface OracleInfo {
    address: string;
    schnorrPubKey: Uint8Array;
    stakedAmount: bigint;    // satoshis staked in DLC
    isActive: boolean;
    lastSeenBlock: bigint;
}

// Message types for P2P gossip
export type GossipMessage =
    | { type: 'price_attestation'; data: PriceAttestation }
    | { type: 'peer_hello'; data: { address: string; pubKey: string } }
    | { type: 'threshold_blob'; round: number; blob: string; roundId?: string };
