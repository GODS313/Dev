const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const clean=(value,max=160)=>String(value??'-').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
export default {
 async fetch(request,env){
  if(request.method==='GET')return reply({ok:true,service:'iLive compatible download relay',version:'3.0.0',ready:Boolean(env.TG_BOT_TOKEN&&env.TG_CHAT_ID&&env.RELAY_SECRET)});
  if(request.method!=='POST')return reply({ok:false,error:'method_not_allowed'},405);
  if(!env.TG_BOT_TOKEN||!env.TG_CHAT_ID||!env.RELAY_SECRET)return reply({ok:false,error:'secrets_not_configured'},503);
  if(!(request.headers.get('content-type')||'').toLowerCase().includes('application/json'))return reply({ok:false,error:'json_required'},415);
  if(Number(request.headers.get('content-length')||0)>8192)return reply({ok:false,error:'payload_too_large'},413);
  let raw='';
  if(request.body){
   const reader=request.body.getReader(),decoder=new TextDecoder();let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return reply({ok:false,error:'payload_too_large'},413);}raw+=decoder.decode(value,{stream:true});}
   raw+=decoder.decode();
  }
  const signature=request.headers.get('X-iLive-Signature')||'';
  if(!/^[a-f0-9]{64}$/i.test(signature))return reply({ok:false,error:'unauthorized'},401);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.RELAY_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,new Uint8Array(signature.match(/.{2}/g).map(x=>parseInt(x,16))),new TextEncoder().encode(raw));
  if(!valid)return reply({ok:false,error:'unauthorized'},401);
  let data;try{data=JSON.parse(raw);}catch{return reply({ok:false,error:'invalid_json'},400);}
  if(!data||typeof data!=='object'||Array.isArray(data))return reply({ok:false,error:'invalid_payload'},422);
  const text=`📥 گزارش دریافت\n\n🌐 سایت: ${clean(data.site,80)}\n🕒 زمان: ${clean(data.time,80)}\n📱 دستگاه: ${clean(data.device,80)}\nرویداد: ${clean(data.event,240)}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.TG_CHAT_ID,text,disable_web_page_preview:true}),signal:controller.signal,redirect:'error'});
   const result=await response.json().catch(()=>null);
   if(!response.ok||result?.ok!==true)return reply({ok:false,error:'telegram_rejected'},502);
   return reply({ok:true,delivered:true});
  }catch{return reply({ok:false,error:'telegram_unreachable'},502);}finally{clearTimeout(timer);}
 }
};
