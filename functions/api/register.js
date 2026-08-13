export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigins = ['https://adlisho.online','https://www.adlisho.online'];
  const origin = request.headers.get('Origin');

  // CORS preflight
  if(request.method === 'OPTIONS'){
    if(allowedOrigins.includes(origin)){
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods':'POST,OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type'
      }});
    }
    return new Response(null,{status:204});
  }

  if (request.method !== 'POST') return new Response(JSON.stringify({ok:false,error:'Method Not Allowed'}), { status: 405, headers:{'Content-Type':'application/json'} });

  // enforce CORS
  const corsHeaders = {};
  if(allowedOrigins.includes(origin)) corsHeaders['Access-Control-Allow-Origin']=origin;

  let json;
  try{ json = await request.json(); } catch(e){ return new Response(JSON.stringify({ok:false,error:'JSON نامعتبر'}),{status:400,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)}); }

  const name = (json.name||'').trim();
  const phone = (json.phone||'').trim();
  const province = (json.province||'').trim();
  const answers = JSON.stringify(json.answers || {});
  if(!name || name.length < 3) return new Response(JSON.stringify({ok:false,error:'نام معتبر نیست'}),{status:400,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  if(!/^09\d{9}$/.test(phone)) return new Response(JSON.stringify({ok:false,error:'شماره موبایل معتبر نیست'}),{status:400,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  if(!province) return new Response(JSON.stringify({ok:false,error:'استان انتخاب نشده'}),{status:400,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});

  // rate limiting: max 5 registrations per IP per hour
  try{
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const oneHourAgo = new Date(Date.now() - 60*60*1000).toISOString().slice(0,19).replace('T',' ');
    const recent = await env.DB.prepare('SELECT COUNT(1) as c FROM registrations WHERE ip = ? AND created_at > ?').bind(ip, oneHourAgo).first();
    const count = recent && recent.c ? recent.c : 0;
    if(count >= 5){
      return new Response(JSON.stringify({ok:false,error:'Rate limit exceeded'}),{status:429,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
    }

    // prevent duplicate by phone
    const existing = await env.DB.prepare('SELECT id,tracking_code,created_at,phone FROM registrations WHERE phone = ?').bind(phone).first();
    if(existing && existing.tracking_code){
      return new Response(JSON.stringify({ok:true,existing:true,tracking:existing.tracking_code}),{status:200,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
    }

    // generate cryptographically secure tracking code (12 chars base36 uppercase)
    const arr = new Uint8Array(9);
    crypto.getRandomValues(arr);
    let tracking = '';
    for(const v of arr) tracking += (v % 36).toString(36);
    tracking = tracking.toUpperCase().slice(0,12);

    // insert
    const insert = await env.DB.prepare('INSERT INTO registrations (name,phone,province,answers,ip,tracking_code) VALUES (?,?,?,?,?,?)').bind(name,phone,province,answers,ip,tracking).run();
    if(!insert.success){
      return new Response(JSON.stringify({ok:false,error:'خطا در ذخیره‌سازی'}),{status:500,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
    }

    return new Response(JSON.stringify({ok:true,tracking}),{status:200,headers:Object.assign({'Content-Type':'application/json'},corsHeaders)});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:'خطا در سرور'}),{status:500,headers:{'Content-Type':'application/json'}});
  }
}
