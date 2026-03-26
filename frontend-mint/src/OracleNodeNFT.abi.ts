import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';
import type { BitcoinInterfaceAbi, FunctionBaseData } from 'opnet';

const fn = (entry: FunctionBaseData): FunctionBaseData => entry;

export const OracleNodeNFTAbi: BitcoinInterfaceAbi = [
    fn({ name: 'mint',        type: BitcoinAbiTypes.Function, inputs: [{ name: 'to', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'adminMint',   type: BitcoinAbiTypes.Function, inputs: [{ name: 'to', type: ABIDataTypes.ADDRESS }], outputs: [] }),
    fn({ name: 'totalSupply', type: BitcoinAbiTypes.Function, constant: true, inputs: [], outputs: [{ name: 'totalSupply', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'balanceOf',   type: BitcoinAbiTypes.Function, constant: true, inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'tokenOfOwnerByIndex', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }, { name: 'index', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'setPayoutAddress', type: BitcoinAbiTypes.Function,
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }, { name: 'btcAddress', type: ABIDataTypes.STRING }],
        outputs: [] }),
    fn({ name: 'getPayoutAddress', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'btcAddress', type: ABIDataTypes.STRING }] }),
    fn({ name: 'setOracleKey', type: BitcoinAbiTypes.Function,
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }, { name: 'schnorrPubKey', type: ABIDataTypes.UINT256 }],
        outputs: [] }),
    fn({ name: 'getOracleKey', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'schnorrPubKey', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'setMintPrice', type: BitcoinAbiTypes.Function, inputs: [{ name: 'price', type: ABIDataTypes.UINT256 }], outputs: [] }),
    ...OP_NET_ABI,
];

export default OracleNodeNFTAbi;
