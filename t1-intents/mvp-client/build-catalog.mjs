import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url),out=new URL('../public/product-v2/',root);
await mkdir(out,{recursive:true});
await build({absWorkingDir:root.pathname,entryPoints:['catalog-entry.jsx'],outfile:new URL('catalog.mjs',out).pathname,bundle:true,format:'esm',target:['es2022'],minify:true,legalComments:'inline',define:{'process.env.NODE_ENV':'"production"'}});
for(const [input,output] of [['source.css','source.css'],['product.css','product.css'],['catalog.css','catalog.css'],['THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.txt']])await writeFile(new URL(output,out),await readFile(new URL(input,root)));
// Product transaction guards reuse the already pinned parent ethers dependency.
// Preserve its full license in this separate output without changing old builds.
await writeFile(new URL('THIRD_PARTY_NOTICES.txt',out),Buffer.concat([await readFile(new URL('THIRD_PARTY_NOTICES.txt',out)),Buffer.from('\n\n===== ethers 6.15.0 (Product v2 transaction validation) =====\n'),await readFile(new URL('../node_modules/ethers/LICENSE.md',root))]));
await writeFile(new URL('index.html',out),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>留膳 · 新产品接入</title><link rel="stylesheet" href="./source.css"><link rel="stylesheet" href="./product.css"><link rel="stylesheet" href="./catalog.css"></head><body><div id="root"></div><script type="module" src="./catalog.mjs"></script></body></html>\n');
console.log('Product catalog built independently; legacy MVP outputs unchanged.');
