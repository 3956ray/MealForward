import {readSync} from 'node:fs';
import {preparePublish,prepareSetListed,catalogTermsHash} from './catalog.mjs';
const methods={preparePublish,prepareSetListed,catalogTermsHash};
try{
  const chunks=[],buf=Buffer.alloc(8192);let total=0,length;
  while((length=readSync(0,buf,0,buf.length,null))!==0){total+=length;if(total>131072)throw Error('LIMIT');chunks.push(Buffer.from(buf.subarray(0,length)));}
  const q=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(Object.keys(q).sort().join()!=='method,parameters'||!Object.hasOwn(methods,q.method))throw Error('METHOD');
  process.stdout.write(JSON.stringify(methods[q.method](q.parameters)));
}catch{process.stdout.write(JSON.stringify({error:'CATALOG_CODEC_REJECTED'}));process.exitCode=1;}
