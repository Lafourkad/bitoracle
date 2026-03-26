# btc-oracle — Status & Architecture Review

> **Dernière mise à jour:** 2026-03-24 16:00 UTC
> **État:** MVP fonctionnel, corrections critiques en cours

---

## Objectif

Réseau d'oracles décentralisé pour **OpNet** (Bitcoin L1) — fournir des price feeds trustless pour la DeFi sur Bitcoin (wBTC OP20, stablecoins, bridges cross-chain).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CONTRATS OPNET (AssemblyScript → WASM)                     │
│  ├─ OracleRegistry  → gère oracles, stake, slash            │
│  └─ PriceFeed       → stocke prix, vérifie signatures       │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │ submitPrice()
┌─────────────────────────────────────────────────────────────┐
│  NŒUD ORACLE TypeScript                                     │
│  ├─ PriceFetcher   → fetch prix depuis APIs (CoinGecko...)  │
│  ├─ OracleSigner   → signe sha256(asset||price||block)      │
│  ├─ P2PNetwork     → libp2p + GossipSub pour consensus      │
│  └─ OpNetSubmitter → broadcast tx vers contrats             │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │ threshold signature
┌─────────────────────────────────────────────────────────────┐
│  THRESHOLD SIGNING (Otzi ML-DSA)                            │
│  └─ Key ceremony → shares distribuées, signature agrégée    │
└─────────────────────────────────────────────────────────────┘
```

---

## Contrats déployés (testnet OpNet)

| Contrat | Adresse | Bloc | Statut |
|---------|---------|------|--------|
| OracleRegistry (v1) | `opt1sqqkvu2fjdtd28kfmucqwuqx5yqsg9mlnvvckrelf` | 11226 | ⚠️ Sans registerOracle |
| PriceFeed (v2) | `opt1sqqp3cxu626kx7lwr2gtt58yaaug85tl6dqfzzxv7` | 11231 | ✅ OK |
| OracleRegistry (v2) | *en cours* | - | 🔄 Redéploiement |

---

## Fichiers clés

### Contrats (`contracts/src/oracle/`)
- `OracleRegistry.ts` — register/stake/slash oracles
- `PriceFeed.ts` — stocker prix, vérifier quorum

### Nœud TypeScript (`node/src/`)
- `OracleSigner.ts` — signature Schnorr
- `PriceFetcher.ts` — fetch APIs externes
- `OracleNode.ts` — orchestrateur
- `P2PNetwork.ts` — libp2p + GossipSub
- `OpNetSubmitter.ts` — broadcast tx OpNet
- `DLCManager.ts` — stake BTC (P2WSH 2-of-2)

### Scripts (`node/src/scripts/`)
- `genkey.ts` — wallet OpNet
- `keygen.ts` — threshold key ceremony
- `deploy.ts` — déploie les 2 contrats
- `deployRegistry.ts` — redéploie OracleRegistry
- `deployPriceFeed.ts` — redéploie PriceFeed
- `setRegistry.ts` — lie PriceFeed → OracleRegistry
- `registerOracle.ts` — enregistre un oracle
- `test.ts` — tests de lecture

---

## 🔴 Faiblesses critiques identifiées

### 1. verifyStakeOutput trop naïf
```typescript
// Vérifie juste qu'un output >= stakeAmount existe
for (let i = 0; i < limit; i++) {
    if (outputs[i].value >= stakeAmountU64) { found = true; break; }
}
```
- L'oracle peut envoyer les sats à lui-même ailleurs
- Pas de vérification que le stake est *verrouillé*
- **Manque :** vérifier que l'output va à une adresse de stake contrôlée par le protocole (DLC/P2WSH)

**Sévérité :** 🔴 CRITIQUE — le stake n'est pas réellement locké

---

### 2. Pas de quorum on-chain
```typescript
// Un seul oracle peut soumettre
this.roundPrice.set(roundKey, price);
```
- Pas de consensus, un oracle suffit
- **Manque :** exiger N signatures d'oracles différents

**Sévérité :** 🔴 CRITIQUE — un oracle compromis = prix fake

---

### 3. Slash ne déplace pas les BTC
```typescript
// publishFraudProof change juste le status
this.statusMap.set(oracleAddr, STATUS_SLASHED);
// Aucun transfert de BTC !
```
- Le stake reste dans le contrat
- L'oracle garde ses fonds

**Sévérité :** 🔴 CRITIQUE — slashing symbolique, pas effectif

---

### 4. Pas de retrait du stake
- `requestUnstake` existe
- Pas de `finalizeUnstake` ou `withdrawStake`
- Les 100k sats sont bloqués à jamais

**Sévérité :** 🔴 CRITIQUE — fonds piégés

---

## 🟡 Faiblesses moyennes

### 5. Spam possible sur submitPrice
- N'importe qui peut appeler `submitPrice`
- Pas de rate limiting
- **Fix :** Seuls oracles enregistrés, max 1/round

### 6. Pas de replay protection
```typescript
// sha256(asset || price || blockNumber)
// Pas de chainId
```
- Signature valide sur tous les réseaux
- **Fix :** Ajouter chainId dans le message

### 7. Signature verification O(n)
- N signatures Schnorr pour N oracles
- Gas explosion avec beaucoup d'oracles
- **Fix :** Threshold signature agrégée (MuSig2)

### 8. Centralisation deployer
```typescript
if (!Blockchain.tx.sender.equals(this.contractDeployer)) {
    throw new Revert('Only deployer');
}
```
- Pas de gouvernance
- **Fix :** Multisig ou DAO

### 9. Leader election statique
```typescript
const leader = sortedAddresses[0]; // Plus petite adresse
```
- Leader peut censurer
- **Fix :** Round-robin ou view-change

### 10. Stockage croissant sans nettoyage
- Chaque round stocké à jamais
- Contrat devient trop gros
- **Fix :** Garder N derniers rounds

---

## Questions ouvertes

1. **Comment lock le stake sur Bitcoin L1 ?**
   - P2WSH avec CSV timelock ?
   - DLC avec chemin slash ?
   - Incident soumis à Bob: INC-mn4smqom-8d15d1

2. **Tokenomics**
   - Comment rémunérer les oracles ?
   - OP20 natif ? Fees en BTC ?

3. **Intégration MuSig2**
   - Séparé de ML-DSA
   - Pour DLC L1 slash path

---

## Roadmap

### Court terme (cette session)
- [x] Déployer contrats sur testnet
- [x] PriceFeed avec btc-runtime 1.11.0
- [x] setRegistry confirmé
- [ ] Redéployer OracleRegistry avec registerOracle
- [ ] Refaire setRegistry
- [ ] Tester registerOracle + submitPrice

### Moyen terme
- [ ] Implémenter quorum on-chain (≥3 signatures)
- [ ] Ajouter withdrawStake après timelock
- [ ] Intégrer vrai mécanisme slash (MuSig2)
- [ ] Rate limiting sur submitPrice

### Long terme
- [ ] Key ceremony distribué (shares sur machines séparées)
- [ ] Gouvernance (multisig/DAO)
- [ ] Leader rotation
- [ ] Nettoyage storage

---

## Dépendances versions

- `opnet`: 1.8.9
- `@btc-vision/transaction`: 1.8.4
- `@btc-vision/btc-runtime`: 1.11.0 (⚠️ 1.11.0-rc.7 cause "Unknown chain id")
- `@btc-vision/bitcoin`: latest
- Node.js: >= 24 (requirement OpNet)

---

## Commandes utiles

```bash
# Deploy contrats
cd projects/btc-oracle/node
OPNET_RPC_URL=https://testnet.opnet.org node --import tsx/esm src/scripts/deploy.ts

# Lier PriceFeed → Registry
OPNET_RPC_URL=https://testnet.opnet.org node --import tsx/esm src/scripts/setRegistry.ts

# Enregistrer oracle
OPNET_RPC_URL=https://testnet.opnet.org node --import tsx/esm src/scripts/registerOracle.ts

# Tests lecture
node --import tsx/esm src/scripts/test.ts
```

---

## Contact / Ressources

- **OpNet docs:** https://docs.opnet.org
- **Bob MCP:** `mcporter call opnet-bob.<tool>`
- **mwaddip** = Muad'Dib, auteur PERMAFROST Vault et Otzi
- **RPC testnet:** https://testnet.opnet.org
- **Opscan:** https://opscan.org (network=op_testnet)
