export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = (url.searchParams.get('code')||'').trim();
  if(!code) return new Response(JSON.stringify({ok:false,error:'کد پیگیری وارد نشده'}),{status:400,headers:{'Content-Type':'application/json'}});
  try{
    const row = await env.DB.prepare('SELECT id,name,province,created_at,tracking_code FROM registrations WHERE tracking_code = ?').bind(code).first();
    if(!row) return new Response(JSON.stringify({ok:false,error:'یافت نشد'}),{status:404,headers:{'Content-Type':'application/json'}});
    // Do not return sensitive fields like phone or answers by default
    return new Response(JSON.stringify({ok:true,record:{id:row.id,name:row.name,province:row.province,created_at:row.created_at,tracking_code:row.tracking_code}}),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:'خطا'}),{status:500,headers:{'Content-Type':'application/json'}});
  }
}
