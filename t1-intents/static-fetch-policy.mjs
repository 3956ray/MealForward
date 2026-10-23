/**
 * Fetch Metadata policy only for the fixed, PUBLIC static files.
 *
 * All GET / and GET /fund-testnet.html return identical, uncached HTML
 * with NO private user data, cookie or state change. They must be reachable
 * by direct browser navigation, link previews and in-app browsers without
 * depending on optional Sec-Fetch-* headers. CSP frame-ancestors 'none' and
 * X-Frame-Options DENY still prevent embedding.
 *
 * JS/CSS loads remain same-origin/none only. Importantly, this policy is
 * NEVER used by the SIWE, Intent or money API; those retain strict Origin,
 * CSRF, wallet principal and immutable financial guards.
 */
export function allowStaticFetchSite({path,method,headers}={}){
 if(method!=='GET'&&method!=='HEAD')return false;
 if(path==='/'||path==='/fund-testnet.html')return true;
 const site=headers?.['sec-fetch-site'];
 return site===undefined||site==='same-origin'||site==='none'||site==='same-site';
}

/**
 * The public HTML response is byte-for-byte the same regardless of URL
 * tracking parameters and never renders or stores them. ChatGPT may append
 * ?utm_source=chatgpt.com when opening links.
 *
 * Keep parameterized API, private Intent, EIP-712 and JS/CSS paths denied.
 * A conservative length bound prevents pathological request-target lengths;
 * this is not a redirect, reflection or authorization decision.
 */
export function allowStaticQuery({path,search}={}){
 if(typeof search!=='string')return false;
 if(search==='')return true;
 if((path!=='/'&&path!=='/fund-testnet.html')||
  !search.startsWith('?')||search.length>512)return false;
 // Only harmless attribution fields may appear on the immutable public HTML.
 // A browser-supplied wallet, Intent, return URL or payment parameter must
 // NEVER be accepted or interpolated into the page.
 const allowed=new Set([
  'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
  'gclid','fbclid','ref'
 ]);
 const params=new URLSearchParams(search);
 if(params.size===0||params.size>8)return false;
 const seen=new Set();
 for(const [key,value] of params){
  if(!allowed.has(key)||seen.has(key)||!value||value.length>120||
   !/^[a-zA-Z0-9._~-]+$/.test(value))return false;
  seen.add(key);
 }
 return true;
}
