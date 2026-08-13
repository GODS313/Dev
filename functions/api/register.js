export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  try{
    const json = await request.json();
    const name = (json.name||'').trim();
    const phone = (json.phone||'').trim();
    const province = (json.province||'').trim();
    const answers = JSON.stringify(json.answers || {});
    // basic validation
    if(!name || name.length < 3) return new Response(JSON.stringify({ok:false,error:'نام معتبر نیست'}),{status:400,headers:{'Content-Type':'application/json'}});
    if(!/^09\d{9}$/.test(phone)) return new Response(JSON.stringify({ok:false,error:'شماره موبایل معتبر نیست'}),{status:400,headers:{'Content-Type':'application/json'}});
    if(!province) return new Response(JSON.stringify({ok:false,error:'استان انتخاب نشده'}),{status:400,headers:{'Content-Type':'application/json'}});

    // prevent duplicate: if this phone already has a registration, return existing tracking code
    const existing = await env.DB.prepare('SELECT id,tracking_code,created_at FROM registrations WHERE phone = ?').bind(phone).first();
    if(existing && existing.tracking_code){
      return new Response(JSON.stringify({ok:true,existing:true,tracking:existing.tracking_code}),{status:200,headers:{'Content-Type':'application/json'}});
    }

    // generate tracking code
    const tracking = (Math.random().toString(36).slice(2,10)).toUpperCase();

    // insert
    const insert = await env.DB.prepare('INSERT INTO registrations (name,phone,province,answers,tracking_code) VALUES (?,?,?,?,?)').bind(name,phone,province,answers,tracking).run();
    if(!insert.success){
      return new Response(JSON.stringify({ok:false,error:'خطا در ذخیره‌سازی'}),{status:500,headers:{'Content-Type':'application/json'}});
    }

    return new Response(JSON.stringify({ok:true,tracking}),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:'پارامترهای ارسالی نامعتبر'}),{status:400,headers:{'Content-Type':'application/json'}});
  }
}
