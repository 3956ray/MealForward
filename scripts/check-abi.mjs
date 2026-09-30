import assert from 'node:assert/strict'
import { artifact } from './local-chain-lib.mjs'
import { mealForwardAbi } from '../src/chain-contract.ts'
const actual = (await artifact()).abi
const shape = item => JSON.stringify({type:item.type,name:item.name,stateMutability:item.stateMutability,anonymous:item.type === 'event' ? Boolean(item.anonymous) : undefined,inputs:item.inputs?.map(p=>({type:p.type,indexed:item.type === 'event' ? Boolean(p.indexed) : undefined})),outputs:item.outputs?.map(p=>({type:p.type}))})
for(const expected of mealForwardAbi) {
  assert(actual.some(item=>shape(item)===shape(expected)), `ABI mismatch: ${expected.type} ${expected.name}`)
}
console.log(`PASS: ${mealForwardAbi.length} shared ABI entries match compiled contract`)
