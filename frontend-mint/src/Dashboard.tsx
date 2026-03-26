/**
 * Dashboard — Node operator panel for OracleNodeNFT holders
 *
 * Shows owned tokens and lets the holder configure:
 *   - BTC payout address
 *   - Schnorr oracle public key
 */

import { useState, useEffect, useCallback } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract } from 'opnet';
import { OracleNodeNFTAbi } from './OracleNodeNFT.abi';
import type { IOracleNodeNFT } from './OracleNodeNFT.types';
import { PROVIDER, OPNET_NETWORK, NFT_ADDRESS } from './config';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TokenData {
    tokenId: bigint;
    payoutAddress: string;
    oracleKey: string;
}

// ── NodeConfig — configure a single NFT token ────────────────────────────────

function NodeConfig({ token, onUpdated }: { token: TokenData; onUpdated: () => void }) {
    const { walletAddress } = useWalletConnect();
    const [payout, setPayout]       = useState(token.payoutAddress);
    const [oracleKey, setOracleKey] = useState(token.oracleKey);
    const [saving, setSaving]       = useState<'payout' | 'key' | null>(null);
    const [msg, setMsg]             = useState('');

    const savePayoutAddress = async () => {
        if (!walletAddress || !payout.trim()) return;
        setSaving('payout'); setMsg('');
        try {
            const contract = getContract<IOracleNodeNFT>(NFT_ADDRESS, OracleNodeNFTAbi, PROVIDER, OPNET_NETWORK);
            const sim = await contract.setPayoutAddress(token.tokenId, payout.trim());
            if (sim.revert) throw new Error(sim.revert);
            const receipt = await sim.sendTransaction({
                signer: null, mldsaSigner: null,
                refundTo: walletAddress,
                maximumAllowedSatToSpend: 20_000n,
                network: OPNET_NETWORK,
            });
            setMsg(`✅ Payout address saved — ${receipt.transactionId.slice(0, 16)}…`);
            onUpdated();
        } catch (e: any) {
            setMsg(`⚠️ ${e.message}`);
        } finally { setSaving(null); }
    };

    const saveOracleKey = async () => {
        if (!walletAddress || !oracleKey.trim()) return;
        // Convert hex pubkey to bigint
        let keyBigInt: bigint;
        try {
            keyBigInt = BigInt('0x' + oracleKey.replace('0x', '').trim());
        } catch {
            setMsg('⚠️ Invalid hex pubkey'); return;
        }
        setSaving('key'); setMsg('');
        try {
            const contract = getContract<IOracleNodeNFT>(NFT_ADDRESS, OracleNodeNFTAbi, PROVIDER, OPNET_NETWORK);
            const sim = await contract.setOracleKey(token.tokenId, keyBigInt);
            if (sim.revert) throw new Error(sim.revert);
            const receipt = await sim.sendTransaction({
                signer: null, mldsaSigner: null,
                refundTo: walletAddress,
                maximumAllowedSatToSpend: 20_000n,
                network: OPNET_NETWORK,
            });
            setMsg(`✅ Oracle key saved — ${receipt.transactionId.slice(0, 16)}…`);
            onUpdated();
        } catch (e: any) {
            setMsg(`⚠️ ${e.message}`);
        } finally { setSaving(null); }
    };

    return (
        <div className="token-card">
            <div className="token-id">Node #{token.tokenId.toString()}</div>

            <div className="field-group">
                <label>BTC Payout Address</label>
                <div className="field-row">
                    <input
                        type="text"
                        placeholder="bc1q…"
                        value={payout}
                        onChange={e => setPayout(e.target.value)}
                        className="field-input"
                    />
                    <button
                        className="btn btn-sm"
                        onClick={savePayoutAddress}
                        disabled={saving === 'payout'}
                    >
                        {saving === 'payout' ? '…' : 'Save'}
                    </button>
                </div>
                <p className="field-hint">BTC address where you'll receive monthly oracle fees</p>
            </div>

            <div className="field-group">
                <label>Schnorr Oracle Key (hex)</label>
                <div className="field-row">
                    <input
                        type="text"
                        placeholder="0x02ab3c…"
                        value={oracleKey}
                        onChange={e => setOracleKey(e.target.value)}
                        className="field-input mono"
                    />
                    <button
                        className="btn btn-sm"
                        onClick={saveOracleKey}
                        disabled={saving === 'key'}
                    >
                        {saving === 'key' ? '…' : 'Save'}
                    </button>
                </div>
                <p className="field-hint">32-byte x-only Schnorr public key for signing oracle updates</p>
            </div>

            {msg && <div className={msg.startsWith('✅') ? 'success-msg' : 'error-msg'}>{msg}</div>}
        </div>
    );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard({ onBack }: { onBack: () => void }) {
    const { publicKey, walletAddress, address } = useWalletConnect();
    const isConnected = publicKey !== null;

    const [tokens, setTokens]   = useState<TokenData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');

    const loadTokens = useCallback(async () => {
        if (!walletAddress) return;
        setLoading(true); setError('');
        try {
            const contract = getContract<IOracleNodeNFT>(NFT_ADDRESS, OracleNodeNFTAbi, PROVIDER, OPNET_NETWORK);

            // Get balance first
            const balResult = await contract.balanceOf(address ?? (walletAddress as any));
            const balance = balResult?.properties?.balance ?? 0n;

            if (balance === 0n) { setTokens([]); return; }

            // Enumerate owned tokens via tokenOfOwnerByIndex
            const owned: TokenData[] = [];
            for (let i = 0n; i < balance; i++) {
                try {
                    const idResult = await contract.tokenOfOwnerByIndex(address ?? (walletAddress as any), i);
                    const tokenId = idResult?.properties?.tokenId;
                    if (tokenId === undefined) continue;

                    // Fetch payout address
                    const payResult = await contract.getPayoutAddress(tokenId);
                    const payout = payResult?.properties?.btcAddress ?? '';

                    // Fetch oracle key
                    const keyResult = await contract.getOracleKey(tokenId);
                    const oracleKey = keyResult?.properties?.schnorrPubKey
                        ? '0x' + keyResult.properties.schnorrPubKey.toString(16).padStart(64, '0')
                        : '';

                    owned.push({ tokenId, payoutAddress: payout, oracleKey });
                } catch { /* skip */ }
            }
            setTokens(owned);
        } catch (e: any) {
            setError(e.message);
        } finally { setLoading(false); }
    }, [walletAddress, address]);

    useEffect(() => { if (isConnected) loadTokens(); }, [isConnected, loadTokens]);

    return (
        <div className="page">
            <div className="card card-wide">
                <div className="logo">
                    <div className="logo-dot" />
                    <h1>Bit<span>Oracle</span></h1>
                </div>

                <div className="dashboard-header">
                    <h2>Node Dashboard</h2>
                    <button className="btn btn-ghost" onClick={onBack}>← Back to Mint</button>
                </div>

                {!isConnected && (
                    <p className="muted-text">Connect your wallet to manage your oracle nodes.</p>
                )}

                {isConnected && loading && (
                    <p className="muted-text">Loading your nodes…</p>
                )}

                {isConnected && !loading && tokens.length === 0 && (
                    <div className="empty-state">
                        <p>You don't own any Oracle Node NFTs yet.</p>
                        <button className="btn btn-primary" onClick={onBack}>Mint a Node →</button>
                    </div>
                )}

                {isConnected && !loading && tokens.length > 0 && (
                    <div className="tokens-list">
                        <p className="muted-text" style={{ marginBottom: '1rem' }}>
                            {tokens.length} node{tokens.length > 1 ? 's' : ''} found
                        </p>
                        {tokens.map(t => (
                            <NodeConfig key={t.tokenId.toString()} token={t} onUpdated={loadTokens} />
                        ))}
                    </div>
                )}

                {error && <div className="error-msg">⚠️ {error}</div>}

                <p className="footer-note">
                    Testnet ·{' '}
                    <a href="https://t.me/+88i5QzgR9BEwZTk0" target="_blank" rel="noreferrer">Telegram</a>
                    {' '}·{' '}
                    <a href="https://x.com/0xGrug" target="_blank" rel="noreferrer">@0xGrug</a>
                </p>
            </div>
        </div>
    );
}
