const primaryUpstream='http://seskia.online/download.php?src=hamkare';
const fallbackUpstream='https://seskia.online/download.php?src=hamkare';

export async function onRequestGet({env}){
  const configured=String(env.APK_DOWNLOAD_URL||'').trim();
  const upstreams=[configured,primaryUpstream,fallbackUpstream].filter((value,index,list)=>/^https?:\/\//i.test(value)&&list.indexOf(value)===index);
  for(const url of upstreams){
    try{
      const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Hamkare-Download-Gateway/1.0','Accept':'application/vnd.android.package-archive,application/octet-stream;q=0.9,*/*;q=0.5'}});
      if(!response.ok||!response.body)continue;
      const headers=new Headers({'Content-Type':response.headers.get('Content-Type')||'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="hamkare.apk"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      const length=response.headers.get('Content-Length');if(length)headers.set('Content-Length',length);
      return new Response(response.body,{status:200,headers});
    }catch(error){console.error('download upstream failed',url,error)}
  }
  return new Response('دانلود موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
