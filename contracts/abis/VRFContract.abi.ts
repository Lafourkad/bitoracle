import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const VRFContractEvents = [];

export const VRFContractAbi = [
    {
        name: 'setAggPubKey',
        inputs: [{ name: 'pubKeyLow', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'requestRandom',
        inputs: [{ name: 'seed', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'requestId', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'fulfillRandom',
        inputs: [
            { name: 'requestId', type: ABIDataTypes.UINT256 },
            { name: 'proof', type: ABIDataTypes.BYTES },
            { name: 'blockHashBytes', type: ABIDataTypes.BYTES },
        ],
        outputs: [{ name: 'output', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getOutput',
        inputs: [{ name: 'requestId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'output', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getRequest',
        inputs: [{ name: 'requestId', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    ...VRFContractEvents,
    ...OP_NET_ABI,
];

export default VRFContractAbi;
