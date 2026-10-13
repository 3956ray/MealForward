// Line-delimited JSON bridge only: caller owns all network IO, endpoint/profile selection and DB boundaries.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { observeRegistration } from './registration-observer.mjs';

export async function runObserverBridge({input,output}) {
  const lines=createInterface({input,crlfDelay:Infinity});
  const iterator=lines[Symbol.asyncIterator]();
  let inputBytes=0,outputBytes=0,id=0,broken=false;
  const hardTimer=setTimeout(()=>{broken=true;input.destroy();lines.close();},43000);
  const inspectChunk=chunk=>{inputBytes+=Buffer.byteLength(chunk);if(inputBytes>2097152){broken=true;input.destroy();lines.close();}};
  input.on('data',inspectChunk);
  async function read() {
    const line=await iterator.next();
    if(broken||line.done||Buffer.byteLength(line.value)>1048576) throw Error('BRIDGE_INPUT_LIMIT');
    return JSON.parse(line.value);
  }
  function write(value) {
    const text=JSON.stringify(value,(_,x)=>typeof x==='bigint'?x.toString():x)+'\n';
    outputBytes+=Buffer.byteLength(text);
    if(outputBytes>2097152) throw Error('BRIDGE_OUTPUT_LIMIT');
    output.write(text);
  }
  try {
    const packet=await read();
    if(packet?.op!=='observe'||Object.keys(packet).some(k=>!['op','profile','original','deployment','transactionHash'].includes(k))) throw Error('INVALID_BRIDGE_OPERATION');
    const transport={async request(method,params){
      const requestId=++id;
      write({type:'rpc',id:requestId,method,params});
      const response=await read();
      if(response?.type!=='rpc-result'||response.id!==requestId||Object.keys(response).some(k=>!['type','id','result'].includes(k))) throw Error('INVALID_BRIDGE_RESPONSE');
      return response.result;
    }};
    const result=await observeRegistration({...packet,transport});
    write({type:'result',result});
  } catch {
    write({type:'result',result:{status:'UNKNOWN',reason:'OBSERVER_BRIDGE_REJECTED',evidence:null}});
  } finally {
    clearTimeout(hardTimer);input.off('data',inspectChunk);lines.close();input.destroy();
  }
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  if(process.argv.length!==2){process.stdout.write('{"type":"result","result":{"status":"UNKNOWN","reason":"NO_RUNNER_ARGUMENTS","evidence":null}}\n');process.exitCode=1;}
  else await runObserverBridge({input:process.stdin,output:process.stdout});
}
