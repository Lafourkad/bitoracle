/**
 * NetworkDashboard — Read-only view of the BitOracle network state
 *
 * Reads OracleRegistry on-chain:
 *   - Total registered nodes
 *   - Per-node: address, pubkey, status, register block, slash count
 *
 * Anyone can view this, no wallet required.
 */

import { useState, useEffect } from 'react';
import { getContract } from 'opnet';
import { PROVIDER, OPNET_NETWORK, REGISTRY_ADDRESS } from './config';
import { OracleRegistryAbi } from './OracleRegistry.abi';
import type { IOracleRegistry } from './OracleRegistry.types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface OracleNode {
    index:          number;
    address:        string;
    pubKeyHex:      string;
    status:         'active' | 'inactive' | 'slashed' | 'pending_unstake';
    registerBlock:  bigint;
    slashCount:     bigint;
    stake:          bigint;
}

const STATUS_LABELS: Record<string, OracleNode['status']> = {
    '0': 'inactive',
    '1': 'active',
    '2': 'slashed',
    '3': 'pending_unstake',
};

const STATUS_COLORS: Record<OracleNode['status'], string> = {
    active:          '#22c55e',
    inactive:        '#6b7280',
    slashed:         '#ef4444',
    pending_unstake: '#f59e0b',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function NetworkDashboard() {
    const [nodes,   setNodes]   = useState<OracleNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');
    const [block,   setBlock]   = useState<bigint | null>(null);

    const loadNetwork = async () => {
        setLoading(true);
        setError('');
        try {
            const contract = getContract<IOracleRegistry>(
                REGISTRY_ADDRESS, OracleRegistryAbi, PROVIDER, OPNET_NETWORK
            );

            // Get current block
            const currentBlock = await PROVIDER.getBlockNumber();
            setBlock(currentBlock);

            // Get oracle count
            const countResult = await contract.getOracleCount();
            if (countResult.revert) throw new Error(countResult.revert);
            const count = Number(countResult.properties.count ?? 0n);

            // Fetch all oracles
            const nodeList: OracleNode[] = [];
            for (let i = 1; i <= count; i++) {
                try {
                    const addrResult = await contract.getOracleAtIndex(BigInt(i));
                    if (addrResult.revert) continue;
                    const addr = addrResult.properties.oracleAddress as string;
                    if (!addr || addr === '0x' + '0'.repeat(40)) continue;

                    const infoResult = await contract.getOracleInfo(addr);
                    if (infoResult.revert) continue;

                    const statusN = String(infoResult.properties.status ?? 0n);
                    nodeList.push({
                        index:         i,
                        address:       addr,
                        pubKeyHex:     (infoResult.properties.pubKeyLow as bigint ?? 0n)
                                           .toString(16).padStart(64, '0'),
                        status:        STATUS_LABELS[statusN] ?? 'inactive',
                        registerBlock: infoResult.properties.registerBlock as bigint ?? 0n,
                        slashCount:    infoResult.properties.slashCount as bigint ?? 0n,
                        stake:         infoResult.properties.stake as bigint ?? 0n,
                    });
                } catch { /* skip this oracle */ }
            }
            setNodes(nodeList);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadNetwork(); }, []);

    const activeCount  = nodes.filter(n => n.status === 'active').length;
    const slashedCount = nodes.filter(n => n.status === 'slashed').length;

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px', fontFamily: 'monospace' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: 0, color: '#f97316', fontSize: 20 }}>⛓ BitOracle Network</h2>
                    {block && (
                        <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>
                            Block #{block.toString()}
                        </div>
                    )}
                </div>
                <button
                    onClick={loadNetwork}
                    disabled={loading}
                    style={{
                        background: '#1f2937', border: '1px solid #374151',
                        color: '#d1d5db', padding: '6px 12px', borderRadius: 6,
                        cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13,
                    }}
                >
                    {loading ? '↻ Loading…' : '↻ Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                {[
                    { label: 'Total Nodes',   value: nodes.length,   color: '#d1d5db' },
                    { label: 'Active',        value: activeCount,    color: '#22c55e' },
                    { label: 'Slashed',       value: slashedCount,   color: '#ef4444' },
                ].map(s => (
                    <div key={s.label} style={{
                        flex: 1, background: '#111827', border: '1px solid #1f2937',
                        borderRadius: 8, padding: '12px 16px', textAlign: 'center',
                    }}>
                        <div style={{ color: s.color, fontSize: 24, fontWeight: 'bold' }}>{s.value}</div>
                        <div style={{ color: '#6b7280', fontSize: 12 }}>{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Error */}
            {error && (
                <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12, marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Node list */}
            {loading && !nodes.length ? (
                <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading nodes…</div>
            ) : nodes.length === 0 ? (
                <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>No nodes registered yet</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {nodes.map(node => (
                        <NodeCard key={node.address} node={node} currentBlock={block ?? 0n} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

function NodeCard({ node, currentBlock }: { node: OracleNode; currentBlock: bigint }) {
    const blocksSince = currentBlock > node.registerBlock
        ? Number(currentBlock - node.registerBlock)
        : 0;

    return (
        <div style={{
            background: '#111827', border: '1px solid #1f2937',
            borderRadius: 10, padding: '14px 16px',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            background: STATUS_COLORS[node.status] + '22',
                            color: STATUS_COLORS[node.status],
                            border: `1px solid ${STATUS_COLORS[node.status]}44`,
                            borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 'bold',
                        }}>
                            {node.status.toUpperCase().replace('_', ' ')}
                        </span>
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>Node #{node.index}</span>
                    </div>
                    <div style={{ color: '#d1d5db', fontSize: 13, marginTop: 6, wordBreak: 'break-all' }}>
                        {node.address}
                    </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: '#6b7280', flexShrink: 0, marginLeft: 12 }}>
                    <div>Block #{node.registerBlock.toString()}</div>
                    <div style={{ marginTop: 2 }}>{blocksSince} blocks ago</div>
                    {node.slashCount > 0n && (
                        <div style={{ color: '#ef4444', marginTop: 2 }}>
                            ⚡ {node.slashCount.toString()}x slashed
                        </div>
                    )}
                </div>
            </div>

            {/* Pubkey */}
            {node.pubKeyHex !== '0'.repeat(64) && (
                <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 4, padding: '6px 8px' }}>
                    <span style={{ color: '#6b7280', fontSize: 11 }}>pubkey: </span>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>{node.pubKeyHex.slice(0, 32)}…</span>
                </div>
            )}

            {/* Stake */}
            <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
                Stake: {(Number(node.stake) / 1e8).toFixed(5)} BTC
            </div>
        </div>
    );
}
