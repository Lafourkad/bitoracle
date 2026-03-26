# BTC Oracle Network — Spec v0.2
_Session: 2026-03-23 | Mis à jour: 2026-03-23_

## Vision
Réseau d'oracles décentralisé pour OpNet (Bitcoin L1), inspiré du modèle cryptographique des DLC.
Objectif : fournir des price feeds trustless pour la DeFi sur Bitcoin — wBTC OP20, stablecoins, bridges cross-chain.

---

## Architecture — 3 couches

### 1. Nœud Oracle (daemon TypeScript) ← ON BUILD ÇA EN PREMIER
**Repo:** `projects/btc-oracle/node/`
**Stack:** TypeScript, Node.js >= 24, ESM

Composants :
- `OracleNode` — orchestrateur principal (tick loop, deviation/heartbeat, quorum)
- `PriceFetcher` — prix depuis Binance, Coinbase, Kraken (médiane locale)
- `OracleSigner` — Schnorr BIP340 via `@btc-vision/transaction` MessageSigner
- `P2PNetwork` — libp2p + GossipSub, TCP, noise, yamux
- `OpNetClient` — JSONRpcProvider (opnet), getBlockNumber, callContract, buildSubmitPriceCalldata
- `DLCManager` — skeleton, à implémenter
- `threshold/` — extrait d'Otzi (mwaddip/otzi), 3-round ML-DSA threshold signing

**Soumission on-chain :** déviation > 0.5% OU heartbeat > 6 blocs.
**Topics P2P :**
- `btc-oracle/prices/v1` — PriceAttestation + peer_hello
- `btc-oracle/threshold/v1` — blobs round1/2/3 ML-DSA threshold

**Message canonique signé :** `sha256(asset_utf8 || price_u64be || blockNumber_u64be)`

### 2. Réseau P2P (libp2p + GossipSub)
- libp2p v3, GossipSub v15, TCP, noise v1, yamux v8
- `allowPublishToZeroTopicPeers: true` (dev mode)
- Bootstrap peers configurables
- Membership = oracles stakés dans OracleRegistry

### 3. Threshold Signing (extrait d'Otzi)
- `@btc-vision/post-quantum` vendored depuis mwaddip/otzi
- 3 rounds : round1() → gossip → round2() → gossip → round3() → combine()
- Résultat : une seule signature ML-DSA FIPS 204 collective → une seule tx OpNet par round
- Remplace le modèle "leader rotatif" — plus trustless

### 4. Contrats OpNet (AssemblyScript) ← EN DERNIER
**OracleRegistry**
- Enregistre les oracles : `ExtendedAddress` (Schnorr + ML-DSA pubkey) + stake vérifié via `tx.outputs`
- Statut : actif / slashé / en retrait
- Publie les preuves de fraude

**PriceFeed**
- Reçoit `(asset, price, blockNumber, signature)` 
- Vérifie via `Blockchain.verifySignature()` (Schnorr + ML-DSA consensus-aware)
- Agrège par médiane, anti-stale via `block.number` (JAMAIS medianTimestamp)

---

## Modèle DLC pour le staking/slashing

```
Bitcoin L1 (DLC)              OpNet (contrat)
────────────────              ───────────────
UTXO staké
  └─ chemin normal  ←──────── oracle se comporte bien → unstake autorisé
  └─ chemin slash   ←──────── OracleRegistry publie preuve de fraude
```

- Les contrats OpNet NE PEUVENT PAS détenir du BTC (calculateurs, pas custodians)
- Le BTC est dans un DLC L1 entre l'oracle et le protocole
- Le contrat OpNet vérifie les outputs (`tx.outputs`) pour enregistrer le stake
- Slash = contrat publie preuve → nœud exécute la tx de slash L1

---

## Cas d'usage débloqués par ce protocole
1. **Price feeds trustless** — DeFi sur Bitcoin
2. **wBTC-style OP20** — oracle atteste le lock BTC L1 → mint OP20S wrapper
3. **Bridge cross-chain** — oracle atteste burn sur chain X → mint OP20 sur OpNet

---

## Stack technique

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Nœud oracle | TypeScript ESM | Node.js 24 |
| Réseau P2P | libp2p + GossipSub | libp2p v3 |
| Threshold signing | @btc-vision/post-quantum (Otzi) | 0.6.0-alpha |
| OpNet RPC | opnet JSONRpcProvider | v1.8.9 |
| Signing | @btc-vision/transaction MessageSigner | v1.8.3 |
| Contrats | AssemblyScript + btc-runtime | v1.11.0-rc.7 |

---

## État du nœud (session 2026-03-23)

✅ Compile sans erreur (tsc --noEmit)
✅ Boot fonctionnel — démarre en ~2s
✅ libp2p TCP sur port 7777, PeerID déterministe
✅ GossipSub abonné aux 2 topics
✅ Prix BTC/USD fetché (Binance/Coinbase/Kraken) + médiane
✅ Block height réel depuis OpNet RPC testnet (block ~11095)
✅ Signature Schnorr BIP340 sur attestation
✅ Vérification des sigs peers avant acceptation
✅ Quorum check (min 3 oracles)

✅ InteractionTransaction — OpNetSubmitter avec TransactionFactory.signInteraction()
✅ Threshold rounds — ThresholdCoordinator + 3 rounds Otzi (leader pattern mwaddip)
✅ Key ceremony — keygen.ts génère shares ML-DSA, ShareLoader charge au boot
✅ DLCManager — P2WSH 2-of-2 stake, withdraw, slash watcher

✅ Contrats OpNet — OracleRegistry.wasm (24KB) + PriceFeed.wasm (25KB) compilés

---

## Questions ouvertes
- [ ] Quorum : >50% ou >66% ?
- [ ] Lib DLC Bitcoin pour le nœud (rust-dlc ? ndlc ?)
- [ ] Rémunération des oracles — token propre ou BTC ?
- [ ] Gouvernance au démarrage — qui whitelist les premiers oracles ?
