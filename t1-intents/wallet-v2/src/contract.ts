export const CHAIN_ID=10143;
export const OWNER='0xc4f8a468f10d5f98dcff3282516125e97f26433b';
export const DONOR='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952';
export const ESCROW='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
export const DOMAIN={name:'MealForward T1F Recovery',version:'1',chainId:CHAIN_ID,verifyingContract:ESCROW} as const;
export const DOMAIN_FIELDS=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}] as const;
export const MESSAGE_FIELDS=[
 {name:'claimId',type:'string'},{name:'reviewId',type:'string'},{name:'slotId',type:'string'},
 {name:'voucherId',type:'bytes32'},{name:'originalOpId',type:'bytes32'},
 {name:'originalNonce',type:'uint256'},{name:'originalDeadline',type:'uint256'},
 {name:'originalDataHash',type:'bytes32'},{name:'newOpId',type:'bytes32'},
 {name:'newNonce',type:'uint256'},{name:'newDeadline',type:'uint256'},
 {name:'nonceDomain',type:'bytes32'},{name:'observedBlockNumber',type:'uint256'},
 {name:'observedBlockHash',type:'bytes32'},{name:'approvalExpiresAt',type:'uint256'}
] as const;
export const PINS={
 claimId:'fbab3b22-965d-44e2-b144-d7307b7aa8ea',
 voucherId:'0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605',
 originalOpId:'0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b',
 originalNonce:'0',originalDeadline:'1792765625',
 originalDataHash:'0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed',
 newNonce:'0'
} as const;
export type Role='owner'|'donor';
export type MessageField=(typeof MESSAGE_FIELDS)[number]['name'];
export type ApprovalMessage=Record<MessageField,string>;
export type ApprovalTypedData={domain:typeof DOMAIN;types:{EIP712Domain:typeof DOMAIN_FIELDS;SuccessorIssueRelease:typeof MESSAGE_FIELDS};primaryType:'SuccessorIssueRelease';message:ApprovalMessage};
export type ApprovalRound={id:string;digest:`0x${string}`;expiresAt:number;typedData:ApprovalTypedData};
export type PublicState={noRelease:true;canIssue:false;chainId:10143;wallets:{owner:string;donor:string};roles:{owner:boolean;donor:boolean};serverTime:number;status:'NO_ROUND'|'COLLECTING'|'COLLECTED_NO_RELEASE'|'EXPIRED';round:ApprovalRound|null};
