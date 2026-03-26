import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const PriceFeedPullEvents = [];

export const PriceFeedPullAbi = [
    {
        name: 'verifyAndGetPrice',
        inputs: [
            { name: 'asset', type: ABIDataTypes.BYTES },
            { name: 'price', type: ABIDataTypes.UINT256 },
            { name: 'blockNum', type: ABIDataTypes.UINT256 },
            { name: 'oracleAddr', type: ABIDataTypes.ADDRESS },
            { name: 'signature', type: ABIDataTypes.BYTES },
        ],
        outputs: [{ name: 'price', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'verifyAndGetPriceQuorum',
        inputs: [
            { name: 'asset', type: ABIDataTypes.BYTES },
            { name: 'price', type: ABIDataTypes.UINT256 },
            { name: 'blockNum', type: ABIDataTypes.UINT256 },
            { name: 'oracles', type: ABIDataTypes.ADDRESS },
            { name: 'sigs', type: ABIDataTypes.BYTES },
        ],
        outputs: [{ name: 'price', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setRegistry',
        inputs: [{ name: 'registry', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    ...PriceFeedPullEvents,
    ...OP_NET_ABI,
];

export default PriceFeedPullAbi;
