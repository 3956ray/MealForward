import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {QRCodeSVG} from 'qrcode.react';

let root;
export function renderCode(value) {
  root ||= createRoot(document.getElementById('collection-qr'));
  flushSync(()=>root.render(createElement(QRCodeSVG,{
    value,size:240,level:'M',marginSize:4,title:'Short-lived collection code',
  })));
}
export function clearQR() {
  if(root)flushSync(()=>root.render(null));
}
