const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:409});};
export function targetIdOf({chainId,escrow}={}) {
  check(Number.isSafeInteger(chainId)&&chainId>0&&typeof escrow==='string'&&/^0x[0-9a-f]{40}$/i.test(escrow)&&BigInt(escrow)!==0n,'INVALID_TARGET');
  return `${chainId}:${escrow.toLowerCase()}`;
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function makeTargetRegistry({legacyTarget,targets=[],activeTargetId}={}) {
  const legacyTargetId=targetIdOf(legacyTarget),entries=new Map();
  for(const target of [legacyTarget,...targets]){
    const id=targetIdOf(target);check(!entries.has(id),'DUPLICATE_TARGET');
    check([7200,259200].includes(target.policySeconds),'TARGET_POLICY_REQUIRED');
    check(target.targetId===undefined||target.targetId===id,'TARGET_ID_MISMATCH');
    entries.set(id,freeze({...structuredClone(target),targetId:id}));
  }
  const get=id=>{check(typeof id==='string'&&entries.has(id),'UNKNOWN_TARGET');return entries.get(id);};
  get(activeTargetId??legacyTargetId);
  return Object.freeze({legacyTargetId,activeTargetId:activeTargetId??legacyTargetId,get,
    active:()=>get(activeTargetId??legacyTargetId),ids:()=>[...entries.keys()],
    forRecord:record=>{check(record&&typeof record==='object','INVALID_TARGET_RECORD');return get(record.targetId===undefined?legacyTargetId:record.targetId);},
  });
}
