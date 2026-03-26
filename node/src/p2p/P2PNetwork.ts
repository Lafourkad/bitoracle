/**
 * P2P network layer — libp2p + GossipSub
 *
 * Handles peer discovery and message propagation between oracle nodes.
 * All oracle price attestations and threshold signing blobs flow through here.
 */

import { createLibp2p, type Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { gossipsub, type GossipSub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { GossipMessage } from '../oracle/types.js';

export type MessageHandler = (msg: GossipMessage, from: string) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLibp2p = Libp2p<any>;

export class P2PNetwork {
    private node: AnyLibp2p | null = null;
    private handlers: MessageHandler[] = [];

    constructor(
        private readonly listenAddresses: string[],
        private readonly bootstrapPeers: string[],
        private readonly topic: string,
    ) {}

    async start(): Promise<void> {
        console.log('[P2P] Starting libp2p node...');

        this.node = await createLibp2p({
            addresses: {
                listen: this.listenAddresses,
            },
            transports: [tcp()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            services: {
                pubsub: gossipsub({
                    allowPublishToZeroTopicPeers: true,  // allow publishing even with no peers (dev mode)
                    emitSelf: false,
                }),
                identify: identify(),
            },
        });

        await this.node.start();

        // Subscribe to our oracle topic
        this.node.services.pubsub.subscribe(this.topic);
        this.node.services.pubsub.subscribe('btc-oracle/threshold/v1');

        // Register message handler
        this.node.services.pubsub.addEventListener('message', (evt: CustomEvent) => {
            this.handleIncoming(evt);
        });

        // Log our addresses
        const addrs = this.node.getMultiaddrs().map(a => a.toString());
        console.log('[P2P] Listening on:');
        addrs.forEach(a => console.log(`  ${a}`));
        console.log(`[P2P] Peer ID: ${this.node.peerId.toString()}`);

        // Connect to bootstrap peers
        for (const peer of this.bootstrapPeers) {
            try {
                await this.node.dial(multiaddr(peer));
                console.log(`[P2P] Connected to bootstrap peer: ${peer}`);
            } catch (err) {
                console.warn(`[P2P] Failed to connect to ${peer}:`, (err as Error).message);
            }
        }

        console.log('[P2P] Ready.');
    }

    async stop(): Promise<void> {
        if (!this.node) return;
        console.log('[P2P] Stopping...');
        await this.node.stop();
        this.node = null;
    }

    /**
     * Broadcast a GossipMessage to all oracle peers on the price topic.
     */
    async broadcast(msg: GossipMessage): Promise<void> {
        if (!this.node) {
            console.warn('[P2P] Cannot broadcast — node not started');
            return;
        }
        const encoded = new TextEncoder().encode(JSON.stringify(msg));
        try {
            await this.node.services.pubsub.publish(this.topic, encoded);
        } catch (err) {
            // "PublishError.NoPeersSubscribedToTopic" is normal during bootstrap
            const msg = (err as Error).message ?? '';
            if (!msg.includes('NoPeers') && !msg.includes('InsufficientPeers')) {
                console.error('[P2P] Broadcast error:', err);
            }
        }
    }

    /**
     * Broadcast a threshold signing blob on the threshold topic.
     * Used during the 3-round ML-DSA threshold signing protocol.
     */
    async broadcastThreshold(blob: string, round: number): Promise<void> {
        if (!this.node) return;
        const msg = JSON.stringify({ type: 'threshold_blob', round, blob });
        const encoded = new TextEncoder().encode(msg);
        try {
            await this.node.services.pubsub.publish('btc-oracle/threshold/v1', encoded);
        } catch {
            // swallow NoPeers during bootstrap
        }
    }

    /**
     * Register a handler for incoming gossip messages.
     */
    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    /**
     * Get the multiaddrs of this node (to share with peers for bootstrapping).
     */
    getAddresses(): string[] {
        return this.node?.getMultiaddrs().map(a => a.toString()) ?? [];
    }

    getPeerId(): string {
        return this.node?.peerId.toString() ?? '';
    }

    getConnectedPeers(): number {
        return this.node?.getPeers().length ?? 0;
    }

    private handleIncoming(evt: CustomEvent): void {
        try {
            const data = evt.detail?.data;
            if (!data) return;
            const text = new TextDecoder().decode(data);
            const msg = JSON.parse(text) as GossipMessage;
            const from: string = evt.detail?.from?.toString() ?? 'unknown';

            for (const handler of this.handlers) {
                handler(msg, from);
            }
        } catch (err) {
            console.error('[P2P] Failed to parse incoming message:', err);
        }
    }
}
