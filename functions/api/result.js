export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigins = ['https://adlisho.online','https://www.adlisho.online'];
  const origin = request.headers.get('Origin');

  // CORS preflight
  if(request.method === 'OPTIONS'){
    if(allowedOrigins.includes(origin)){
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods':'GET,OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type'
      }});
    }
    return new Response(null,{status:204});
  }

  if(request.method !== 'GET') return new Response(JSON.stringify({ok:false,error:'Method Not Allowed'}),{status:405,headers:{'Content-Type':'application/json'}});
  const url = new URL(request.url);
  const code = (url.searchParams.get('code')||'').trim();
  const last4 = (url.searchParams.get('last4')||'').trim();
  const corsHeaders = {};
  if(allowedOrigins.includes(origin)) corsHeaders['Access-Control-Allow-Origin']=origin;
  if(!code || !/^[A-Z0-9]{6,}$/i.test(code)) return new Response(JSON.stringify({ok:false,error:'کد پیگیری نامعتبر'}),{status:400,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  if(!last4 || !/^[0-9]{4}$/.test(last4)) return new Response(JSON.stringify({ok:false,error:'چهار رقم آخر موبایل مورد نیاز است'}),{status:400,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  try{
    const row = await env.DB.prepare('SELECT id,name,province,phone,created_at,tracking_code FROM registrations WHERE tracking_code = ?').bind(code).first();
    if(!row) return new Response(JSON.stringify({ok:false,error:'یافت نشد'}),{status:404,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
    const phone = row.phone || '';
    if(phone.slice(-4) !== last4) return new Response(JSON.stringify({ok:false,error:'موتور اعتبارسنجی ناموفق'}),{status:403,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
    return new Response(JSON.stringify({ok:true,record:{id:row.id,name:row.name,province:row.province,created_at:row.created_at,tracking_code:row.tracking_code}}),{status:200,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:'خطا در سرور'}),{status:500,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  }
}
