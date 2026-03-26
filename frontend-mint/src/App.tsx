import { useState, useEffect } from 'react';
import { useWalletConnect, WalletConnectProvider } from '@btc-vision/walletconnect';
import { getContract } from 'opnet';
import { OracleNodeNFTAbi } from './OracleNodeNFT.abi';
import type { IOracleNodeNFT } from './OracleNodeNFT.types';
import { Dashboard } from './Dashboard';
import { NetworkDashboard } from './NetworkDashboard';
import { NFT_ADDRESS, MAX_SUPPLY, MINT_PRICE, OPNET_NETWORK, PROVIDER } from './config';

// ── MintWidget ────────────────────────────────────────────────────────────────
function MintWidget({ onDashboard, onNetwork }: { onDashboard: () => void; onNetwork: () => void }) {
  const {
    publicKey,
    address,
    walletAddress,
    openConnectModal,
    disconnect,
    connecting,
  } = useWalletConnect();

  const isConnected = publicKey !== null;

  const [totalMinted, setTotalMinted] = useState(0);
  const [minting, setMinting]         = useState(false);
  const [txHash, setTxHash]           = useState('');
  const [error, setError]             = useState('');

  useEffect(() => {
    async function fetchSupply() {
      try {
        const contract = getContract<IOracleNodeNFT>(NFT_ADDRESS, OracleNodeNFTAbi, PROVIDER, OPNET_NETWORK);
        const result = await contract.totalSupply();
        if (result?.properties?.totalSupply !== undefined) {
          setTotalMinted(Number(result.properties.totalSupply));
        }
      } catch (e) {
        console.warn('Failed to fetch supply:', e);
      }
    }
    fetchSupply();
  }, []);

  const handleMint = async () => {
    if (!walletAddress) { setError('Wallet not connected'); return; }
    setError(''); setMinting(true);
    try {
      const contract  = getContract<IOracleNodeNFT>(NFT_ADDRESS, OracleNodeNFTAbi, PROVIDER, OPNET_NETWORK);
      const recipient: any = address ?? walletAddress;
      const callResult = await contract.mint(recipient);
      if (callResult.revert) throw new Error('Reverted: ' + callResult.revert);
      const receipt = await callResult.sendTransaction({
        signer: null, mldsaSigner: null,
        refundTo: walletAddress,
        maximumAllowedSatToSpend: 20_000n,
        network: OPNET_NETWORK,
      });
      if (!receipt?.transactionId) throw new Error('No txid returned');
      setTxHash(receipt.transactionId);
      setTotalMinted(prev => prev + 1);
    } catch (e: any) {
      console.error('[Mint error]', e);
      setError(e.message || 'Mint failed');
    } finally { setMinting(false); }
  };

  const pct = Math.round((totalMinted / MAX_SUPPLY) * 100);

  return (
    <div className="page">
      <div className="card">
        <div className="logo">
          <div className="logo-dot" />
          <h1>Bit<span>Oracle</span></h1>
        </div>

        <h2>Founder Node NFT</h2>
        <p className="subtitle">
          Mint your node operator pass. Earn BTC fees monthly from the oracle network.
        </p>

        <div className="stats-grid">
          <div className="stat">
            <div className="stat-label">Mint Price</div>
            <div className="stat-value accent">{MINT_PRICE.toLocaleString()} sats</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total Supply</div>
            <div className="stat-value">{MAX_SUPPLY} NFTs</div>
          </div>
          <div className="stat">
            <div className="stat-label">Minted</div>
            <div className="stat-value">{totalMinted} / {MAX_SUPPLY}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Network</div>
            <div className="stat-value" style={{ fontSize: '0.85rem' }}>OpNet Testnet</div>
          </div>
        </div>

        <div className="progress-wrap">
          <div className="progress-label">
            <span>Supply minted</span><span>{pct}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {isConnected && walletAddress && (
          <div className="wallet-info">
            <span>
              <span className="wallet-dot" />
              <span className="wallet-addr">{walletAddress.slice(0, 14)}…{walletAddress.slice(-8)}</span>
            </span>
            <button className="disconnect" onClick={disconnect}>Disconnect</button>
          </div>
        )}

        {!isConnected ? (
          <button className="btn btn-primary" onClick={openConnectModal} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect OPWallet'}
          </button>
        ) : !txHash ? (
          <button className="btn btn-primary" onClick={handleMint} disabled={minting}>
            {minting ? 'Minting…' : `Mint for ${MINT_PRICE.toLocaleString()} sats`}
          </button>
        ) : null}

        {txHash && (
          <div className="tx-success">
            ✅ Minted!<br />
            <a href={`https://explorer.opnet.org/tx/${txHash}`} target="_blank" rel="noreferrer">
              View tx → {txHash.slice(0, 20)}…
            </a>
          </div>
        )}

        {error && <div className="error-msg">⚠️ {error}</div>}

        {isConnected && (
          <button className="btn btn-ghost" onClick={onDashboard} style={{ marginTop: '0.75rem' }}>
            ⚙️ Manage my nodes →
          </button>
        )}
        <button className="btn btn-ghost" onClick={onNetwork} style={{ marginTop: '0.5rem', opacity: 0.7 }}>
          🌐 View network status →
        </button>

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

// ── App ───────────────────────────────────────────────────────────────────────

function AppInner() {
  const [view, setView] = useState<'mint' | 'dashboard' | 'network'>('mint');

  if (view === 'dashboard') return <Dashboard onBack={() => setView('mint')} />;
  if (view === 'network')   return (
      <div>
          <div style={{ textAlign: 'center', padding: '12px 0', background: '#0f172a', borderBottom: '1px solid #1f2937' }}>
              <button onClick={() => setView('mint')} style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: 14 }}>
                  ← Back to Mint
              </button>
          </div>
          <NetworkDashboard />
      </div>
  );
  return <MintWidget onDashboard={() => setView('dashboard')} onNetwork={() => setView('network')} />;
}

export default function App() {
  return (
    <WalletConnectProvider theme="dark">
      <AppInner />
    </WalletConnectProvider>
  );
}
