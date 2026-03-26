/**
 * Main oracle node — orchestrates price fetching, signing, P2P gossip,
 * threshold signing rounds, and OpNet submission.
 */

import type { OracleConfig } from '../config/config.js';
import { PriceFetcher } from './PriceFetcher.js';
import { OracleSigner } from './Signer.js';
import { P2PNetwork } from '../p2p/P2PNetwork.js';
import { OpNetClient } from '../opnet/OpNetClient.js';
import { OpNetSubmitter } from '../opnet/OpNetSubmitter.js';
import { ThresholdCoordinator } from '../threshold/ThresholdCoordinator.js';
import { ShareLoader } from '../threshold/ShareLoader.js';
import { PriceCache } from '../api/PriceCache.js';
import { HttpServer } from '../api/HttpServer.js';
import type { PriceAttestation, AggregatedPrice, GossipMessage } from './types.js';

export class OracleNode {
    private readonly fetcher: PriceFetcher;
    private readonly signer: OracleSigner;
    private readonly p2p: P2PNetwork;
    private readonly opnet: OpNetClient;
    private readonly submitter: OpNetSubmitter;
    private threshold: ThresholdCoordinator | null = null;
    private running = false;
    private tickInterval: NodeJS.Timeout | null = null;

    // Round buffer: asset → attestations from all peers this round
    private readonly roundBuffer = new Map<string, Map<string, PriceAttestation>>();

    // Known oracle pubkeys: address → pubkey (populated from P2P hellos + registry)
    private readonly knownOracles = new Map<string, Uint8Array>();

    // Last submitted price + block per asset
    private readonly lastPrice = new Map<string, bigint>();
    private lastSubmittedBlock = 0n;
    private lastBlock = 0n;
    private readonly http: HttpServer;

    constructor(private readonly config: OracleConfig) {
        this.fetcher = new PriceFetcher(config.priceSources);
        this.signer = new OracleSigner(config);
        this.p2p = new P2PNetwork(
            config.p2p.listenAddresses,
            config.p2p.bootstrapPeers,
            config.p2p.topic,
        );

        this.opnet = new OpNetClient(config.opnet, config.network);
        this.submitter = new OpNetSubmitter(
            config.opnet.rpcUrl,
            config.btcPrivateKey,
            config.network,
        );

        // Register our own pubkey
        this.knownOracles.set(this.signer.oracleAddress, this.signer.publicKey);

        // HTTP API
        this.http = new HttpServer(config.apiPort ?? 8080);
        this.http.onStatus(() => ({
            version: '0.4.0',
            network: config.network,
            uptime: 0, // overridden by HttpServer
            lastBlock: this.lastBlock,
            oracleAddress: this.signer.oracleAddress,
            assets: config.assets,
            quorum: { required: config.minQuorum, connected: this.knownOracles.size },
        }));

        // Load threshold share if available (set SHARE_PATH + SHARE_PASSWORD env vars)
        const share = ShareLoader.loadFromEnv();
        if (share) {
            this.threshold = new ThresholdCoordinator(this.p2p, share, share.partyId);
            console.log(
                `[OracleNode] Threshold signing enabled — party ${share.partyId}/${share.parties} ` +
                `(T=${share.threshold})`,
            );
        } else {
            console.log('[OracleNode] No share loaded — running in single-sig fallback mode');
        }
    }

    async start(): Promise<void> {
        this.running = true;
        console.log('[OracleNode] Starting...');
        console.log(`[OracleNode] Oracle address: ${this.signer.oracleAddress}`);

        // Start HTTP API
        await this.http.start();

        // Start P2P and register message handler
        await this.p2p.start();
        this.p2p.onMessage(this.handleP2PMessage.bind(this));

        // Announce ourselves to the network
        await this.p2p.broadcast({
            type: 'peer_hello',
            data: {
                address: this.signer.oracleAddress,
                pubKey: Buffer.from(this.signer.publicKey).toString('hex'),
            },
        });

        // TODO: start DLC watcher

        // Main loop — tick every ~30s (will be block-driven later)
        this.tickInterval = setInterval(() => this.tick(), 30_000);
        await this.tick();
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.tickInterval) clearInterval(this.tickInterval);
        await this.http.stop();
        await this.p2p.stop();
        this.opnet.close();
        this.submitter.close();
        console.log('[OracleNode] Stopped.');
    }

    // -------------------------------------------------------------------------
    // P2P message handling
    // -------------------------------------------------------------------------

    private handleP2PMessage(msg: GossipMessage, from: string): void {
        switch (msg.type) {
            case 'peer_hello':
                this.handlePeerHello(msg.data);
                break;
            case 'price_attestation':
                this.handlePeerAttestation(msg.data, from);
                break;
            case 'threshold_blob':
                if (this.threshold && msg.blob) {
                    // Parse the inner threshold message
                    try {
                        const inner = JSON.parse(msg.blob);
                        this.threshold.handleMessage(inner).catch((err) => {
                            console.error('[OracleNode] Threshold message error:', err);
                        });
                    } catch {
                        console.warn('[OracleNode] Failed to parse threshold blob');
                    }
                }
                break;
        }
    }

    private handlePeerHello(data: { address: string; pubKey: string }): void {
        const pubKey = new Uint8Array(Buffer.from(data.pubKey, 'hex'));
        this.knownOracles.set(data.address, pubKey);
        console.log(`[OracleNode] Peer registered: ${data.address.slice(0, 16)}...`);
    }

    private handlePeerAttestation(attestation: PriceAttestation, from: string): void {
        // Verify signature before accepting
        const pubKey = this.knownOracles.get(attestation.oracleAddress);
        if (!pubKey) {
            console.warn(`[OracleNode] Unknown oracle ${attestation.oracleAddress}, ignoring`);
            return;
        }

        if (!OracleSigner.verify(attestation, pubKey)) {
            console.warn(`[OracleNode] Invalid signature from ${attestation.oracleAddress}, ignoring`);
            return;
        }

        this.addToRoundBuffer(attestation);
        console.log(
            `[OracleNode] Accepted attestation from ${attestation.oracleAddress.slice(0, 16)}...` +
            ` ${attestation.asset}=${attestation.price}`,
        );
    }

    // -------------------------------------------------------------------------
    // Main loop
    // -------------------------------------------------------------------------

    private async tick(): Promise<void> {
        if (!this.running) return;
        try {
            for (const asset of this.config.assets) {
                await this.processAsset(asset);
            }
        } catch (err) {
            console.error('[OracleNode] Tick error:', err);
        }
    }

    private async processAsset(asset: string): Promise<void> {
        const price = await this.fetcher.fetchPrice(asset);
        const blockNumber = await this.getCurrentBlock();

        // Check deviation + heartbeat
        const last = this.lastPrice.get(asset) ?? 0n;
        if (!this.shouldSubmit(price, last, blockNumber)) {
            console.log(`[OracleNode] ${asset}: stable (${price}), skipping`);
            return;
        }

        // Sign our attestation
        const attestation = await this.signer.sign(asset, price, blockNumber);
        console.log(`[OracleNode] ${asset}: signed price=${price} block=${blockNumber}`);

        // Add ours to local buffer
        this.addToRoundBuffer(attestation);

        // Broadcast to peers
        await this.p2p.broadcast({ type: 'price_attestation', data: attestation });

        // Try to aggregate once we have quorum
        await this.tryAggregateAndSubmit(asset, blockNumber);
    }

    private shouldSubmit(price: bigint, lastPrice: bigint, blockNumber: bigint): boolean {
        if (lastPrice === 0n) return true;

        const diff = price > lastPrice ? price - lastPrice : lastPrice - price;
        const deviationPct = Number(diff * 10000n / lastPrice) / 100;
        if (deviationPct >= this.config.deviationThreshold) return true;

        const blocksSinceLast = Number(blockNumber - this.lastSubmittedBlock);
        if (blocksSinceLast >= this.config.heartbeatBlocks) return true;

        return false;
    }

    private addToRoundBuffer(attestation: PriceAttestation): void {
        if (!this.roundBuffer.has(attestation.asset)) {
            this.roundBuffer.set(attestation.asset, new Map());
        }
        this.roundBuffer.get(attestation.asset)!.set(attestation.oracleAddress, attestation);
    }

    // -------------------------------------------------------------------------
    // Aggregation + submission
    // -------------------------------------------------------------------------

    private async tryAggregateAndSubmit(asset: string, blockNumber: bigint): Promise<void> {
        const attestations = [...(this.roundBuffer.get(asset)?.values() ?? [])];

        if (attestations.length < this.config.minQuorum) {
            console.log(
                `[OracleNode] ${asset}: quorum not reached (${attestations.length}/${this.config.minQuorum})`,
            );
            return;
        }

        // Median of all valid attested prices
        const prices = attestations.map(a => a.price).sort((a, b) => (a < b ? -1 : 1));
        const mid = Math.floor(prices.length / 2);
        const medianPrice = prices.length % 2 === 0
            ? (prices[mid - 1] + prices[mid]) / 2n
            : prices[mid];

        const aggregated: AggregatedPrice = {
            asset,
            price: medianPrice,
            blockNumber,
            attestations,
            leaderAddress: this.signer.oracleAddress,
        };

        console.log(`[OracleNode] ${asset}: aggregated median=${medianPrice}`);

        if (this.threshold) {
            // Threshold path — 3-round ML-DSA collective signature
            const roundId = `${asset}:${blockNumber}`;
            const message = OracleSigner.buildMessage(asset, medianPrice, blockNumber);
            const activePartyIds = attestations.map((_, i) => i + 1); // placeholder

            // Deterministic leader election: lowest oracle address in the active set wins
            const sortedAddresses = attestations.map(a => a.oracleAddress).sort();
            const isLeader = sortedAddresses[0] === this.signer.oracleAddress;
            console.log(`[OracleNode] ${asset}: threshold round, isLeader=${isLeader}`);

            await this.threshold.startRound(
                roundId,
                message,
                activePartyIds,
                isLeader,
                async (result) => {
                    console.log(`[OracleNode] ${asset}: threshold sig ready, submitting...`);
                    await this.submitToOpNet({ ...aggregated, thresholdSig: result.signature });
                },
            );
        } else {
            // Fallback: direct submission with individual Schnorr sig (no threshold)
            await this.submitToOpNet(aggregated);
        }

        this.lastPrice.set(asset, medianPrice);
        this.lastSubmittedBlock = blockNumber;
        this.roundBuffer.delete(asset);
    }

    private async submitToOpNet(aggregated: AggregatedPrice): Promise<void> {
        // Use threshold sig if available, otherwise fall back to our individual Schnorr sig
        let signature: Uint8Array;
        if (aggregated.thresholdSig) {
            signature = aggregated.thresholdSig;
            console.log(`[OracleNode] Using threshold ML-DSA signature (${signature.length} bytes)`);
        } else {
            const ourAttestation = aggregated.attestations.find(
                a => a.oracleAddress === this.signer.oracleAddress,
            );
            if (!ourAttestation) {
                console.error('[OracleNode] Cannot submit — no signature available');
                return;
            }
            signature = ourAttestation.signature;
            console.log(`[OracleNode] Using individual Schnorr signature (fallback)`);
        }

        const calldata = OpNetClient.buildSubmitPriceCalldata(
            aggregated.asset,
            aggregated.price,
            aggregated.blockNumber,
            signature,
        );

        const contractAddress = this.config.opnet.priceFeedContractAddress;
        if (!contractAddress) {
            console.warn('[OracleNode] No PriceFeed contract address configured — skipping submit');
            console.log(`[OracleNode] Calldata (${calldata.length} bytes): ${calldata.toString('hex').slice(0, 32)}...`);
            return;
        }

        try {
            const txid = await this.submitter.submitPrice(contractAddress, calldata);
            console.log(`[OracleNode] ✅ Submitted: ${txid}`);
            // Update price cache after successful submission
            PriceCache.getInstance().set({
                asset: aggregated.asset,
                price: aggregated.price,
                blockNumber: aggregated.blockNumber,
                timestamp: Date.now(),
                quorum: aggregated.attestations.length,
                txid,
            });
        } catch (err) {
            console.error('[OracleNode] Submit failed:', (err as Error).message);
        }
    }

    private async getCurrentBlock(): Promise<bigint> {
        try {
            const block = await this.opnet.getBlockNumber();
            this.lastBlock = block;
            return block;
        } catch (err) {
            console.warn('[OracleNode] Failed to get block number from RPC, using estimate:', err);
            return BigInt(Math.floor(Date.now() / 600_000));
        }
    }
}
