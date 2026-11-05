import React,{useMemo,useState} from 'react';
import {createThirdwebClient,defineChain} from 'thirdweb';
import {ThirdwebProvider,ConnectEmbed,lightTheme} from 'thirdweb/react';
import {createWallet,EIP1193} from 'thirdweb/wallets';
// UI only: authentication, payment guards and recovery remain in CatalogEntry.
export default function ThirdwebLogin({clientId,onVerify,busy}) {
 const client=useMemo(()=>createThirdwebClient({clientId}),[clientId]);
 const wallets=useMemo(()=>[createWallet('io.metamask'),createWallet('io.rabby'),createWallet('com.coinbase.wallet'),createWallet('com.okex.wallet')],[]);
 const [wallet,setWallet]=useState(null);
 return <ThirdwebProvider>{!wallet?<ConnectEmbed client={client} wallets={wallets} autoConnect={false} locale="zh_CN" onConnect={setWallet} theme={lightTheme({colors:{primaryButtonBg:'#284C3E',primaryButtonText:'#ffffff',modalBg:'#FAF8F3',accentText:'#284C3E'}})}/>:<div className="wallet-verification"><h3>验证钱包身份</h3><p>钱包已连接。点击下方按钮后，在钱包中确认登录签名。</p><button className="button" disabled={busy} onClick={()=>onVerify(EIP1193.toProvider({wallet,client,chain:wallet.getChain()||defineChain(10143)}))}>验证并登录</button><button className="button outline" disabled={busy} onClick={()=>setWallet(null)}>更换钱包</button></div>}</ThirdwebProvider>;
}
