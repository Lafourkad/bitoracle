/**
 * ThresholdCoordinator — orchestrates 3-round ML-DSA threshold signing over P2P.
 *
 * Design (based on Otzi v2 pattern from mwaddip):
 * - One deterministic LEADER per round controls advancement and resets
 * - Followers execute rounds and send blobs to leader only
 * - Leader decides when to advance (round1→2→3) or reset (combine failed)
 * - Leader broadcasts the final OpNet transaction
 *
 * Leader election: deterministic on sha256(asset + blockNumber) → stable per round,
 * no re-election needed unless leader goes offline.
 *
 * ML-DSA threshold signing is probabilistic — round3/combine() can fail.
 * On failure: leader broadcasts RESET, all parties restart from round1.
 * Expected convergence: typically within a few retries.
 */

import {
    createSession,
    round1,
    round2,
    round3,
    combine,
    addBlob,
    destroySession,
    type SigningSession,
} from './threshold.js';
import type { DecryptedShare } from './share-crypto.js';
import type { P2PNetwork } from '../p2p/P2PNetwork.js';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ThresholdResult {
    signature: Uint8Array;
    roundId: string;
}

export type RoundCompleteCallback = (result: ThresholdResult) => void;

export type ThresholdRoundMsg =
    | { kind: 'blob'; roundId: string; round: 1 | 2 | 3; blob: string; from: string }
    | { kind: 'advance'; roundId: string; toRound: 2 | 3 }
    | { kind: 'reset'; roundId: string; attempt: number };

interface RoundState {
    session: SigningSession;
    roundId: string;
    message: Uint8Array;
    activePartyIds: number[];
    isLeader: boolean;
    currentRound: 1 | 2 | 3;
    attempt: number;
    onComplete: RoundCompleteCallback;
    timeoutHandle: NodeJS.Timeout;
}

const ROUND_TIMEOUT_MS = 60_000;   // 60s total per attempt
const MAX_ATTEMPTS = 20;            // give up after 20 retries

// ─────────────────────────────────────────────
// Coordinator
// ─────────────────────────────────────────────

export class ThresholdCoordinator {
    private readonly rounds = new Map<string, RoundState>();

    constructor(
        private readonly p2p: P2PNetwork,
        private readonly share: DecryptedShare,
        private readonly myPartyId: number,
    ) {}

    // ── Public API ──────────────────────────────

    /**
     * Start a threshold signing round.
     * isLeader should be determined by the caller (deterministic election).
     */
    async startRound(
        roundId: string,
        message: Uint8Array,
        activePartyIds: number[],
        isLeader: boolean,
        onComplete: RoundCompleteCallback,
    ): Promise<void> {
        if (this.rounds.has(roundId)) {
            console.warn(`[Threshold] Round ${roundId} already active`);
            return;
        }

        console.log(
            `[Threshold] Starting round ${roundId} ` +
            `attempt=1 leader=${isLeader} parties=${activePartyIds.length} threshold=${this.share.threshold}`,
        );

        await this.initRound(roundId, message, activePartyIds, isLeader, onComplete, 1);
    }

    /**
     * Handle an incoming threshold message from P2P.
     * Called by OracleNode when a threshold_blob message arrives.
     */
    async handleMessage(msg: ThresholdRoundMsg): Promise<void> {
        switch (msg.kind) {
            case 'blob':
                await this.handleBlob(msg);
                break;
            case 'advance':
                await this.handleAdvance(msg);
                break;
            case 'reset':
                await this.handleReset(msg);
                break;
        }
    }

    // ── Round lifecycle ──────────────────────────

    private async initRound(
        roundId: string,
        message: Uint8Array,
        activePartyIds: number[],
        isLeader: boolean,
        onComplete: RoundCompleteCallback,
        attempt: number,
    ): Promise<void> {
        const session = createSession(message, this.share, activePartyIds);

        const timeoutHandle = setTimeout(() => {
            console.error(`[Threshold] Round ${roundId} attempt ${attempt} timed out`);
            if (isLeader) {
                this.leaderReset(roundId).catch(console.error);
            } else {
                // Follower just cleans up — leader will broadcast reset
                this.cleanupRound(roundId);
            }
        }, ROUND_TIMEOUT_MS);

        const state: RoundState = {
            session,
            roundId,
            message,
            activePartyIds,
            isLeader,
            currentRound: 1,
            attempt,
            onComplete,
            timeoutHandle,
        };

        this.rounds.set(roundId, state);

        // Everyone runs round1 and broadcasts their blob
        const blob = round1(session);
        await this.broadcastBlob(roundId, 1, blob);

        // Leader checks immediately if quorum already met (unlikely but safe)
        if (isLeader) {
            await this.leaderTryAdvance(roundId);
        }
    }

    // ── Leader logic ─────────────────────────────

    /**
     * Leader checks if it has enough blobs to advance to the next round.
     * Called after each incoming blob.
     */
    private async leaderTryAdvance(roundId: string): Promise<void> {
        const state = this.rounds.get(roundId);
        if (!state || !state.isLeader) return;

        const { session, currentRound } = state;
        const threshold = this.share.threshold;

        if (currentRound === 1) {
            if (session.collectedRound1Hashes.size < threshold) return;

            console.log(`[Threshold] ${roundId}: leader advancing to round2`);
            state.currentRound = 2;

            // Tell followers to advance
            await this.p2p.broadcastThreshold(
                JSON.stringify({ kind: 'advance', roundId, toRound: 2 }),
                0,
            );

            const blob = round2(session);
            await this.broadcastBlob(roundId, 2, blob);
            await this.leaderTryAdvance(roundId);

        } else if (currentRound === 2) {
            if (session.collectedRound2Commitments.size < threshold) return;

            console.log(`[Threshold] ${roundId}: leader advancing to round3`);
            state.currentRound = 3;

            await this.p2p.broadcastThreshold(
                JSON.stringify({ kind: 'advance', roundId, toRound: 3 }),
                0,
            );

            const blob = round3(session);
            await this.broadcastBlob(roundId, 3, blob);
            await this.leaderTryAdvance(roundId);

        } else if (currentRound === 3) {
            if (session.collectedRound3Responses.size < threshold) return;

            console.log(`[Threshold] ${roundId}: leader combining...`);
            const sig = combine(session);

            if (!sig) {
                // Probabilistic failure — reset and retry
                console.warn(`[Threshold] ${roundId}: combine() failed, resetting`);
                await this.leaderReset(roundId);
                return;
            }

            console.log(`[Threshold] ${roundId}: ✅ signature produced (${sig.length} bytes)`);
            const onComplete = state.onComplete;
            this.cleanupRound(roundId);
            onComplete({ signature: sig, roundId });
        }
    }

    private async leaderReset(roundId: string): Promise<void> {
        const state = this.rounds.get(roundId);
        if (!state) return;

        const nextAttempt = state.attempt + 1;
        if (nextAttempt > MAX_ATTEMPTS) {
            console.error(`[Threshold] ${roundId}: max attempts (${MAX_ATTEMPTS}) reached, aborting`);
            this.cleanupRound(roundId);
            return;
        }

        console.log(`[Threshold] ${roundId}: leader broadcasting RESET → attempt ${nextAttempt}`);

        // Broadcast reset to all followers
        await this.p2p.broadcastThreshold(
            JSON.stringify({ kind: 'reset', roundId, attempt: nextAttempt }),
            0,
        );

        // Restart our own session
        const { message, activePartyIds, onComplete } = state;
        this.cleanupRound(roundId);
        await this.initRound(roundId, message, activePartyIds, true, onComplete, nextAttempt);
    }

    // ── Follower logic ───────────────────────────

    private async handleAdvance(msg: { roundId: string; toRound: 2 | 3 }): Promise<void> {
        const state = this.rounds.get(msg.roundId);
        if (!state || state.isLeader) return;

        if (state.currentRound >= msg.toRound) return; // already there

        console.log(`[Threshold] ${msg.roundId}: follower advancing to round${msg.toRound}`);
        state.currentRound = msg.toRound;

        let blob: string;
        if (msg.toRound === 2) {
            blob = round2(state.session);
        } else {
            blob = round3(state.session);
        }

        await this.broadcastBlob(msg.roundId, msg.toRound, blob);
    }

    private async handleReset(msg: { roundId: string; attempt: number }): Promise<void> {
        const state = this.rounds.get(msg.roundId);
        if (!state || state.isLeader) return;

        console.log(`[Threshold] ${msg.roundId}: follower resetting → attempt ${msg.attempt}`);

        const { message, activePartyIds, onComplete } = state;
        this.cleanupRound(msg.roundId);
        await this.initRound(msg.roundId, message, activePartyIds, false, onComplete, msg.attempt);
    }

    private async handleBlob(msg: { roundId: string; round: 1 | 2 | 3; blob: string }): Promise<void> {
        const state = this.rounds.get(msg.roundId);
        if (!state) return;

        const result = addBlob(state.session, msg.blob, msg.round);
        if (!result.ok) {
            console.warn(`[Threshold] ${msg.roundId}: rejected blob — ${result.error}`);
            return;
        }

        // Only the leader advances rounds
        if (state.isLeader) {
            await this.leaderTryAdvance(msg.roundId);
        }
    }

    // ── Helpers ──────────────────────────────────

    private async broadcastBlob(roundId: string, round: number, blob: string): Promise<void> {
        const msg = JSON.stringify({
            kind: 'blob',
            roundId,
            round,
            blob,
            from: String(this.myPartyId),
        });
        await this.p2p.broadcastThreshold(msg, round);
    }

    private cleanupRound(roundId: string): void {
        const state = this.rounds.get(roundId);
        if (!state) return;
        clearTimeout(state.timeoutHandle);
        destroySession(state.session);
        this.rounds.delete(roundId);
    }

    get activeRoundCount(): number {
        return this.rounds.size;
    }
}
