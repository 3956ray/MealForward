import {fail} from './service.mjs';

/** Standalone product API adapter; not mounted by the deployed MVP runtime.
 * authorize must validate the product session cookie and (for writes) CSRF.
 * Never pass an address taken from request JSON/headers as an authenticated user.
 */
export function makeProductHttp({service,claims=null,redemptions=null,publications=null,approvals=null,settings=null,cancellations=null,configuration=null,authorize,origin,enabled=false}) {
  if (typeof authorize!=='function' || !/^https:\/\/[a-z0-9-]+\.onrender\.com$|^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)) throw Error('PRODUCT_AUTH_AND_ORIGIN_REQUIRED');
  const host=new URL(origin).host;
  return async(req,res) => {
    const send=(status,body) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
    try {
      const url=new URL(req.url,origin), path=url.pathname.slice('/v1/product'.length), write=!['GET','HEAD'].includes(req.method);
      if (!url.pathname.startsWith('/v1/product/')) return false;
      if (req.headers.host!==host || url.origin!==origin || req.headers.origin && req.headers.origin!==origin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin') fail('ORIGIN_DENIED',403);
      if (write && req.headers.origin!==origin) fail('ORIGIN_DENIED',403);
      if (!enabled) fail('PRODUCT_NOT_CONNECTED',503);
      if (req.method==='GET'&&path==='/configuration'&&!url.search&&configuration) {send(200,configuration);return true;}
      if(req.method==='GET'&&path==='/ledger'&&!url.search){send(200,await service.ledger());return true;}
      if (req.method==='GET' && path==='/catalog' && !url.search) {send(200,await service.catalog());return true;}
      const session=await authorize(req,{write});
      if (!session?.wallet) fail('UNAUTHENTICATED',401);
      if (write && session.csrfVerified!==true) fail('CSRF',403);
      if (req.method==='GET' && path==='/me' && !url.search) {
        send(200,await service.identity(session.wallet));return true;
      }
      let body;
      if (write) {
        if ((req.headers['content-type']||'').split(';')[0]!=='application/json') fail('JSON_REQUIRED',415);
        let count=0,chunks=[];
        for await (const chunk of req) {count+=chunk.length;if(count>16384)fail('BODY_TOO_LARGE',413);chunks.push(chunk);}
        try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail('INVALID_JSON',400);}
      }
      let value, match;
      if (req.method==='GET' && path==='/drafts' && [...url.searchParams.keys()].join()==='storeId') value=await service.drafts(session.wallet,url.searchParams.get('storeId'));
      else if (redemptions&&req.method==='GET'&&path==='/merchant/payouts'&&[...url.searchParams.keys()].join()==='storeId') value=await redemptions.payouts(session.wallet,url.searchParams.get('storeId'));
      else if(publications&&req.method==='GET'&&path==='/merchant/refunds'&&[...url.searchParams.keys()].join()==='storeId')value=await publications.refunds(session.wallet,url.searchParams.get('storeId'));
      else if (url.search) fail('INVALID_REQUEST',422);
      else if(cancellations&&['GET','POST'].includes(req.method)&&(match=path.match(/^\/operation-cancellations\/(intents|approvals|publications|redemptions)\/([a-zA-Z0-9_-]{1,96})$/)))value=await cancellations[req.method==='GET'?'get':'record'](session.wallet,match[1],match[2],...(req.method==='POST'?[body]:[]));
      else if(settings&&['GET','PUT'].includes(req.method)&&(match=path.match(/^\/kitchens\/([a-zA-Z0-9_-]{1,96})\/settings$/))) value=await settings[req.method==='GET'?'get':'save'](session.wallet,match[1],...(req.method==='PUT'?[body]:[]));
      else if (req.method==='PUT' && (match=path.match(/^\/drafts\/([a-zA-Z0-9_-]{1,96})$/))) value=await service.saveDraft(session.wallet,match[1],body);
      else if (req.method==='POST' && path==='/publication-reviews') value=await service.reviewPublication(session.wallet,body);
      else if (req.method==='POST' && path==='/support-reviews') value=await service.reviewSupport(session.wallet,body);
      else if (req.method==='POST' && path==='/support-intents') value=await service.confirmSupport(session.wallet,body);
      else if (approvals&&req.method==='POST'&&path==='/approvals') value=await approvals.prepare(session.wallet,body);
      else if (approvals&&req.method==='GET'&&path==='/approvals') value=await approvals.operations(session.wallet);
      else if (approvals&&req.method==='GET'&&(match=path.match(/^\/approvals\/by-request\/([a-zA-Z0-9_-]{1,96})$/))) {const op=await approvals.byRequest(session.wallet,match[1]);value=await approvals.reconcile(session.wallet,op.id);}
      else if (publications&&req.method==='POST'&&path==='/registration-reviews') value=await publications.reviewRegistration(session.wallet,body);
      else if (publications&&req.method==='POST'&&path==='/registrations') value=await publications.confirmRegistration(session.wallet,body);
      else if (publications&&req.method==='POST'&&path==='/publications') value=await publications.confirmPublication(session.wallet,body);
      else if (publications&&req.method==='POST'&&path==='/merchant/supplements') value=await publications.supplement(session.wallet,body);
      else if (publications&&req.method==='POST'&&path==='/merchant/listing') value=await publications.setListed(session.wallet,body);
      else if(publications&&req.method==='POST'&&path==='/merchant/closure')value=await publications.prepareClosure(session.wallet,body);
      else if(publications&&req.method==='POST'&&path==='/merchant/refunds')value=await publications.prepareRefund(session.wallet,body);
      else if (publications&&req.method==='GET'&&path==='/catalog-operations') value=await publications.operations(session.wallet);
      else if (publications&&req.method==='GET'&&(match=path.match(/^\/catalog-operations\/by-request\/([a-zA-Z0-9_-]{1,96})$/))) {const op=await publications.byRequest(session.wallet,match[1]);value=await publications.reconcile(session.wallet,op.id);}
      else if (redemptions&&req.method==='POST'&&path==='/merchant/check') value=await redemptions.check(session.wallet,session.sessionScope,body);
      else if (redemptions&&req.method==='POST'&&path==='/merchant/locks') value=await redemptions.reserveHandover(session.wallet,session.sessionScope,body);
      else if (redemptions&&req.method==='POST'&&path==='/merchant/handovers') value=await redemptions.prepareHandover(session.wallet,session.sessionScope,body);
      else if (redemptions&&req.method==='POST'&&path==='/merchant/settlement-reviews') value=await redemptions.reviewSettlement(session.wallet,body);
      else if (redemptions&&req.method==='POST'&&path==='/merchant/settlements') value=await redemptions.confirmSettlement(session.wallet,body);
      else if (redemptions&&req.method==='GET'&&path==='/merchant/operations') value=await redemptions.operations(session.wallet,session.sessionScope);
      else if (redemptions&&req.method==='GET'&&(match=path.match(/^\/merchant\/operations\/by-request\/([a-zA-Z0-9_-]{1,96})$/))) {const op=await redemptions.byRequest(session.wallet,match[1],session.sessionScope);await redemptions.reconcile(session.wallet,op.id);value=await redemptions.operation(session.wallet,op.id,session.sessionScope);}
      else if(redemptions&&req.method==='POST'&&(match=path.match(/^\/merchant\/operations\/([a-zA-Z0-9_-]{1,96})\/resume$/))) value=await redemptions.resumeHandover(session.wallet,match[1],session.sessionScope,body);
      else if (req.method==='GET'&&(match=path.match(/^\/(approvals|catalog-operations|merchant\/operations)\/([a-zA-Z0-9_-]{1,96})$/))) {
        const domain=match[1]==='catalog-operations'?publications:match[1]==='approvals'?approvals:redemptions;if(!domain)fail('NOT_FOUND',404);
        await domain.reconcile(session.wallet,match[2]);value=await domain.operation(session.wallet,match[2],session.sessionScope);
      }
      else if(redemptions&&req.method==='POST'&&(match=path.match(/^\/merchant\/operations\/([a-zA-Z0-9_-]{1,96})\/cancel-invalidated$/))){
        if(!body||Object.keys(body).length)fail('INVALID_REQUEST',422);
        value=await redemptions.cancel(session.wallet,match[1],session.sessionScope,true);
      }
      else if (req.method==='POST'&&(match=path.match(/^\/(approvals|catalog-operations|merchant\/operations)\/([a-zA-Z0-9_-]{1,96})\/(attempt|hash|reconcile|cancel)$/))) {
        const domain=match[1]==='catalog-operations'?publications:match[1]==='approvals'?approvals:redemptions,action=match[3];if(!domain||typeof domain[action==='hash'?'recordHash':action]!=='function')fail('NOT_FOUND',404);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join()!==(action==='hash'?'txHash':''))fail('INVALID_REQUEST',422);
        value=await domain[action==='hash'?'recordHash':action](session.wallet,match[2],...(action==='hash'?[body.txHash]:[session.sessionScope]));
        if(domain===redemptions&&action==='reconcile')value=await domain.operation(session.wallet,match[2],session.sessionScope);
      }
      else if (claims && req.method==='POST' && path==='/claim-reviews') value=await claims.review(session.wallet,body);
      else if (claims && req.method==='POST' && path==='/claim-intents') value=await claims.confirm(session.wallet,body);
      else if (claims && req.method==='GET' && (match=path.match(/^\/claims\/by-request\/([a-zA-Z0-9_-]{1,96})$/))) {
        const original=await claims.byRequest(session.wallet,match[1]);value=await claims.reconcile(session.wallet,original.id);
      }
      else if (claims && req.method==='GET' && (match=path.match(/^\/claims\/([a-zA-Z0-9_-]{1,96})$/))) value=await claims.reconcile(session.wallet,match[1]);
      else if (claims && req.method==='GET' && path==='/vouchers') value=await claims.vouchers(session.wallet);
      else if (claims && req.method==='GET' && (match=path.match(/^\/vouchers\/([a-zA-Z0-9_-]{1,96})$/))) value=await claims.voucher(session.wallet,match[1]);
      else if (claims && req.method==='POST' && (match=path.match(/^\/vouchers\/([a-zA-Z0-9_-]{1,96})\/display$/))) {
        if(!body||Object.keys(body).length||Array.isArray(body))fail('INVALID_REQUEST',422);
        value=await claims.display(session.wallet,match[1]);
      }
      else if (req.method==='GET' && path==='/orders') value=await service.orders(session.wallet);
      else if (req.method==='GET' && (match=path.match(/^\/intents\/([a-zA-Z0-9_-]{1,96})$/))) value=await service.reconcile(session.wallet,match[1]);
      else if (req.method==='POST' && (match=path.match(/^\/intents\/([a-zA-Z0-9_-]{1,96})\/(attempt|hash|reconcile|cancel)$/))) {
        const action=match[2];
        if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).sort().join()!==(action==='hash'?'txHash':'')) fail('INVALID_REQUEST',422);
        value=await ({attempt:()=>service.attempt(session.wallet,match[1]),hash:()=>service.recordHash(session.wallet,match[1],body.txHash),reconcile:()=>service.reconcile(session.wallet,match[1]),cancel:()=>service.cancel(session.wallet,match[1])})[action]();
      } else fail('NOT_FOUND',404);
      send(200,value);return true;
    } catch(error) {send(error.status||503,{error:error.code||'PRODUCT_UNAVAILABLE'});return true;}
  };
}
