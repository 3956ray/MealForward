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
