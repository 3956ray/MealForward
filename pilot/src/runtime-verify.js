/**
 * An untrusted ?pilot= URL must never choose an arbitrary ERC20 for Approve.
 * Require the EXACT locally compiled reviewed Pilot runtime, ignoring only
 * solc-declared immutable locations, and require the precise worthless
 * PilotMealCredit token bytecode, not a real USDC contract or arbitrary asset.
 *
 * Read-only code verification; no wallet access and no network calls here.
 */
export function matchesDeployedRuntime(actualCode,artifact){
 const expected=artifact?.runtimeTemplate;
 if(typeof actualCode!=='string'||typeof expected!=='string'||
   !/^0x[0-9a-fA-F]+$/.test(actualCode)||!/^0x[0-9a-fA-F]+$/.test(expected)||
   actualCode.length!==expected.length)return false;
 const actual=actualCode.toLowerCase(),runtime=expected.toLowerCase();
 const spans=[];
 const refs=artifact?.immutableReferences??{};
 if(refs===null||typeof refs!=='object'||Array.isArray(refs))return false;
 for(const slots of Object.values(refs)){
  if(!Array.isArray(slots))return false;
  for(const slot of slots){
   if(!Number.isSafeInteger(slot.start)||!Number.isSafeInteger(slot.length)||
    slot.start<0||slot.length<=0)return false;
   const start=2+slot.start*2,end=start+slot.length*2;
   if(end>actual.length)return false;
   spans.push({start,end});
  }
 }
 spans.sort((a,b)=>a.start-b.start);
 let cursor=2;
 for(const {start,end} of spans){
  if(start<cursor||actual.slice(cursor,start)!==runtime.slice(cursor,start))return false;
  cursor=end;
 }
 return actual.slice(cursor)===runtime.slice(cursor);
}
