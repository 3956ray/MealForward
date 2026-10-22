/**
 * Fetch Metadata policy for PUBLIC, non-personalized immutable static assets.
 * Navigating to the landing page from ChatGPT or another site must work.
 * Never relax API/CSRF, private Intent, original quote or payment routes.
 *
 * MDN Fetch Metadata: top-level GET document navigation is an allowed
 * exception to cross-site resource isolation; scripts/iframes are not.
 */
export function allowStaticFetchSite({path,method,headers}={}){
 const site=headers?.['sec-fetch-site'];
 if(site===undefined||site==='same-origin'||site==='none')return true;
 return site==='cross-site'&&method==='GET'&&
  (path==='/'||path==='/fund-testnet.html')&&
  headers['sec-fetch-mode']==='navigate'&&
  headers['sec-fetch-dest']==='document'&&
  !headers.origin;
}
