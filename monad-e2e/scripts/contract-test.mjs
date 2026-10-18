import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import hre from 'hardhat';
import {ethers} from 'ethers';

if(process.env.MONAD_PRIVATE_KEY||process.env.DEPLOYER_PRIVATE_KEY||process.env.MNEMONIC)
 throw Error('NO_EXTERNAL_SIGNING_KEYS_ALLOWED_IN_ISOLATED_EVM_TEST');

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifact=JSON.parse(readFileSync(resolve(root,'artifact.generated.json'),'utf8'));
const {contract:escrowArtifact,localMockToken:mockArtifact,token}=artifact;
const provider=new ethers.BrowserProvider(hre.network.provider);
const currentNetwork=await provider.getNetwork();
assert.equal(currentNetwork.chainId,10143n,'Hardhat only, chainID 10143');

const [merchant,donor,recipient,outsider,recipient2]=await Promise.all(
 [0,1,2,3,4].map(i=>provider.getSigner(i))
);
const merchantAddress=await merchant.getAddress(),
 donorAddress=await donor.getAddress(), recipientAddress=await recipient.getAddress();

await hre.network.provider.request({method:'hardhat_setCode',
 params:[token.address,mockArtifact.runtimeCode]});
const usdc=new ethers.Contract(token.address,mockArtifact.abi,merchant);
await (await usdc.mint(donorAddress,30_000_000n)).wait();
assert.equal(await usdc.balanceOf(donorAddress),30_000_000n);

const factory=new ethers.ContractFactory(escrowArtifact.abi,escrowArtifact.bytecode,merchant);
const escrow=await factory.deploy();
await escrow.waitForDeployment();
const address=await escrow.getAddress();
const chainCode=await provider.getCode(address);
assert.equal(ethers.keccak256(chainCode),escrowArtifact.runtimeCodeHash,
 'No alternate contract, proxy or compiler output permitted');
assert.equal(await escrow.owner(),merchantAddress);
assert.equal(await escrow.ASSET(),token.address);
assert.equal(await escrow.UNIT_PRICE(),7_000_000n);

const donorContract=escrow.connect(donor),beneficiaryContract=escrow.connect(recipient),
 secondBeneficiary=escrow.connect(recipient2),outsiderContract=escrow.connect(outsider);
await (await usdc.connect(donor).approve(address,14_000_000n)).wait();
let funded=await (await donorContract.fund(2)).wait();
assert.equal(funded.status,1);
assert.equal(await escrow.totalFunded(),2n);
assert.equal(await escrow.available(),2n);
assert.equal(await usdc.balanceOf(address),14_000_000n);
assert.equal(await escrow.donorFundedUnits(donorAddress),2n);
assert.equal(await usdc.balanceOf(donorAddress),16_000_000n);

// Original claimant chooses private 32-byte random preimage. Never expose
// any signer key; this is synthetic local EVM-only voucher material.
const secret=ethers.hexlify(ethers.randomBytes(32));
const commitment=ethers.keccak256(secret);
const claimReceipt=await (await beneficiaryContract.claim(commitment)).wait();
assert.equal(claimReceipt.status,1);
const claimLog=claimReceipt.logs
 .map(log=>{try{return escrow.interface.parseLog(log)}catch{return null}})
 .find(log=>log?.name==='VoucherClaimed');
assert.ok(claimLog);
assert.equal(claimLog.args.voucherId,1n);
assert.equal(claimLog.args.recipient,recipientAddress);
assert.equal(await escrow.available(),1n);
assert.equal((await escrow.vouchers(1)).stage,1n);

await assert.rejects(()=>beneficiaryContract.claim(ethers.keccak256(ethers.randomBytes(32))));
await assert.rejects(()=>outsiderContract.checkVoucher(1,secret));
await assert.rejects(()=>escrow.checkVoucher(1,ethers.ZeroHash));
await assert.rejects(()=>escrow.lock(1));
assert.equal((await escrow.vouchers(1)).stage,1n);

await (await escrow.checkVoucher(1,secret)).wait();
assert.equal((await escrow.vouchers(1)).stage,2n);
await assert.rejects(()=>escrow.checkVoucher(1,secret));
await (await escrow.lock(1)).wait();
assert.equal((await escrow.vouchers(1)).stage,3n);
await assert.rejects(()=>escrow.report(2));
await (await escrow.report(1)).wait();
assert.equal((await escrow.vouchers(1)).stage,4n);

await assert.rejects(()=>escrow.settle(1),'30-second reporting delay enforced');
await hre.network.provider.request({method:'evm_increaseTime',params:[31]});
await hre.network.provider.request({method:'evm_mine',params:[]});
const timeInfo=await provider.getBlock('latest');
console.log(JSON.stringify({diagnostics:'SETTLE_PRECHECK',reportedAt:String((await escrow.vouchers(1)).reportedAt),
 currentTimestamp:String(timeInfo.timestamp),
 earlySettlementSelector:ethers.id('EarlySettlement()').slice(0,10),
 transferFailedSelector:ethers.id('TransferFailed()').slice(0,10),
 wrongStageSelector:ethers.id('WrongStage()').slice(0,10)}));
const originalOwnerBalance=await usdc.balanceOf(merchantAddress);
const final=await (await escrow.settle(1)).wait();
assert.equal(final.status,1);
assert.equal((await escrow.vouchers(1)).stage,5n);
assert.equal(await escrow.totalSettled(),1n);
assert.equal(await escrow.liability(),7_000_000n);
assert.equal(await usdc.balanceOf(merchantAddress)-originalOwnerBalance,7_000_000n);
assert.equal(await usdc.balanceOf(address),7_000_000n);
await assert.rejects(()=>escrow.settle(1));

// The other funded meal remains available, can only be claimed once by a
// separate recipient address. Pause prevents NEW funding/issue but preserves
// existing owner settlement rights for already reported vouchers.
const commitment2=ethers.keccak256(ethers.randomBytes(32));
await (await secondBeneficiary.claim(commitment2)).wait();
assert.equal(await escrow.available(),0n);
await assert.rejects(()=>outsiderContract.claim(commitment2));
await (await escrow.setPaused(true)).wait();
await assert.rejects(()=>donorContract.fund(1));
await (await escrow.setPaused(false)).wait();

// Hard lifetime cap: no paid unit beyond 10 (this account has 2 so far).
await (await usdc.mint(donorAddress,80_000_000n)).wait();
await (await usdc.connect(donor).approve(address,80_000_000n)).wait();
for(let i=0;i<4;i++)await (await donorContract.fund(2)).wait();
assert.equal(await escrow.totalFunded(),10n);
await assert.rejects(()=>donorContract.fund(1));
assert.equal(await escrow.MAX_FUNDED_UNITS(),10n);

console.log(JSON.stringify({
 status:'LOCAL_EVM_PASS',
 network:'Hardhat synthetic chain 10143 (NOT public Monad)',
 escrowCodeHash:escrowArtifact.runtimeCodeHash,
 stages:['fund','claim','check','lock','report','settle'],
 merchantPayoutBaseUnits:'7000000',
 remainingLiabilityBaseUnits:String(await escrow.liability()),
 capLifetimeFunded:10,
 noPrivateKeysImported:true,
 noPublicBlockchainTransaction:true
}));
