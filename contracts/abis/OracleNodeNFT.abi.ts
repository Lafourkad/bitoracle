import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const OracleNodeNFTEvents = [];

export const OracleNodeNFTAbi = [
    {
        name: 'adminMint',
        inputs: [{ name: 'to', type: ABIDataTypes.ADDRESS }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'mint',
        inputs: [{ name: 'to', type: ABIDataTypes.ADDRESS }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setPayoutAddress',
        inputs: [
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
            { name: 'btcAddress', type: ABIDataTypes.STRING },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getPayoutAddress',
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setOracleKey',
        inputs: [
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
            { name: 'schnorrPubKey', type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getOracleKey',
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setMintPrice',
        inputs: [{ name: 'price', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setTreasuryAddress',
        inputs: [{ name: 'btcAddress', type: ABIDataTypes.STRING }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    ...OracleNodeNFTEvents,
    ...OP_NET_ABI,
];

export default OracleNodeNFTAbi;
