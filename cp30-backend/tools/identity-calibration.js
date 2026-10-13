import {createDynamicAuthClient} from '/assets/identity.js';
const auth=createDynamicAuthClient();
const node=id=>document.getElementById(id);
let busy=false;
function controls(value){busy=value;document.querySelectorAll('button').forEach(button=>{button.disabled=value;});}
node('email-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;controls(true);node('result').textContent='';
  let email=node('email').value;
  try{await auth.startEmail(email);node('status').textContent='请输入收到的验证码。';}
  catch{node('status').textContent='发送失败；请核对新 origin 的配置。';}
  finally{email=null;controls(false);}
});
node('otp-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;controls(true);node('result').textContent='';
  let otp=node('otp').value;node('otp').value='';let token=null;
  try{
    await auth.verifyOtp(otp);otp=null;token=auth.getAccessToken();if(!token)throw Error();
    const response=await fetch('/identity-calibration/inspect',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
      headers:{'Content-Type':'application/json','X-CP30-Identity-Calibration':'1'},body:JSON.stringify({accessToken:token})});
    token=null;if(!response.ok)throw Error();const result=await response.json();
    node('result').textContent=JSON.stringify(result,null,2);node('status').textContent='已完成验签及脱敏诊断；配置尚未批准。';
  }catch{node('status').textContent='校准失败；未创建业务会话。';}
  finally{otp=null;token=null;await auth.logout().catch(()=>{});controls(false);}
});
node('clear').addEventListener('click',async()=>{
  if(busy)return;controls(true);try{await auth.logout();node('status').textContent='已清除登录样本。';}
  catch{node('status').textContent='本地样本已清除；服务端退出状态未确认。';}
  finally{node('email').value='';node('otp').value='';node('result').textContent='';controls(false);}
});
window.addEventListener('pagehide',()=>{auth.logout().catch(()=>{});});
