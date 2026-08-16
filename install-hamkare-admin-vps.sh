#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }
W=/var/www/adlisho
S=/var/lib/hamkare-admin
C=$S/config.json
T=/opt/hamkare-bots/telegram.env
B=/opt/hamkare-bots/bale.env
A=$W/admin.php
H=/usr/local/sbin/hamkare-admin-apply
[[ -d $W && -f $T && -f $B ]] || { echo "Hamkare paths not found"; exit 1; }
BK=/var/backups/hamkare-admin-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"; cp -a "$T" "$B" "$BK/"
read -rsp "Admin password (minimum 12 characters): " P; echo
[[ ${#P} -ge 12 ]] || { echo "Password too short"; exit 1; }
HASH="$(P="$P" php -r 'echo password_hash(getenv("P"), PASSWORD_DEFAULT);')"; unset P
install -d -o www-data -g www-data -m 0700 "$S"
python3 - "$C" "$T" "$B" "$HASH" <<'PY'
import json,os,sys
c,t,b,h=sys.argv[1:]
def env(p):
 d={}
 for line in open(p,encoding="utf-8"):
  if "=" in line and not line.lstrip().startswith("#"):
   k,v=line.rstrip("\n").split("=",1);d[k]=v
 return d
te,be=env(t),env(b)
old={}
try: old=json.load(open(c,encoding="utf-8"))
except Exception: pass
data={"password_hash":h,"download_source":old.get("download_source","https://seskia.online/est/download"),"telegram_token":old.get("telegram_token",te.get("BOT_TOKEN",te.get("TG_TOKEN",""))),"telegram_chat_id":old.get("telegram_chat_id",te.get("LOG_CHAT_ID",te.get("TG_LOG",""))),"bale_token":old.get("bale_token",be.get("BOT_TOKEN",be.get("BALE_TOKEN",""))),"bale_chat_id":old.get("bale_chat_id",be.get("LOG_CHAT_ID",be.get("BALE_LOG","")))}
tmp=c+".tmp";open(tmp,"w",encoding="utf-8").write(json.dumps(data,ensure_ascii=False,indent=2)+"\n");os.chmod(tmp,0o600);os.replace(tmp,c)
PY
chown www-data:www-data "$C"; chmod 0600 "$C"
cat > "$H" <<'PY'
#!/usr/bin/python3
import json,os,re,shutil,subprocess,tempfile,time
C="/var/lib/hamkare-admin/config.json"; files={"telegram":"/opt/hamkare-bots/telegram.env","bale":"/opt/hamkare-bots/bale.env"}
d=json.load(open(C,encoding="utf-8")); tp=re.compile(r"^[A-Za-z0-9_:.-]{20,256}$"); cp=re.compile(r"^-?[0-9]{4,20}$")
for p in files:
 if not tp.fullmatch(str(d.get(p+"_token",""))) or not cp.fullmatch(str(d.get(p+"_chat_id",""))): raise SystemExit("invalid settings")
bk="/var/backups/hamkare-panel-save-"+time.strftime("%Y%m%d-%H%M%S");os.makedirs(bk,mode=0o700)
for p,path in files.items():
 shutil.copy2(path,bk);st=os.stat(path);lines=open(path,encoding="utf-8").read().splitlines();vals={"BOT_TOKEN":str(d[p+"_token"]),"LOG_CHAT_ID":str(d[p+"_chat_id"]),"DOWNLOAD_URL":"https://adlisho.online/download.php"};out=[];seen=set()
 for line in lines:
  k=line.split("=",1)[0] if "=" in line else ""
  if k in vals:out.append(k+"="+vals[k]);seen.add(k)
  else:out.append(line)
 for k,v in vals.items():
  if k not in seen:out.append(k+"="+v)
 fd,tmp=tempfile.mkstemp(prefix=".env-",dir=os.path.dirname(path));os.fchmod(fd,0o600);os.fchown(fd,st.st_uid,st.st_gid)
 with os.fdopen(fd,"w",encoding="utf-8") as f:f.write("\n".join(out)+"\n");f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
for s in ("hamkare-telegram.service","hamkare-bale.service"):subprocess.run(["systemctl","restart",s],check=True)
PY
chmod 0750 "$H";chown root:root "$H"
echo "www-data ALL=(root) NOPASSWD: $H" >/etc/sudoers.d/hamkare-admin
chmod 0440 /etc/sudoers.d/hamkare-admin;visudo -cf /etc/sudoers.d/hamkare-admin
cat > "$A" <<'PHP'
<?php
declare(strict_types=1);session_name('hamkare');session_set_cookie_params(['secure'=>true,'httponly'=>true,'samesite'=>'Strict']);session_start();
header('Cache-Control:no-store');header('X-Frame-Options:DENY');header('X-Robots-Tag:noindex,nofollow');
const C='/var/lib/hamkare-admin/config.json';const H='/usr/local/sbin/hamkare-admin-apply';
function c(){return json_decode((string)file_get_contents(C),true);}
$msg=$err='';if(isset($_GET['logout'])){session_destroy();header('Location:/admin.php');exit;}
if($_SERVER['REQUEST_METHOD']==='POST')try{$d=c();if(isset($_POST['login'])){if(!password_verify((string)$_POST['password'],$d['password_hash']))throw new Exception('رمز اشتباه است');session_regenerate_id(true);$_SESSION['ok']=1;$_SESSION['csrf']=bin2hex(random_bytes(24));header('Location:/admin.php');exit;}if(empty($_SESSION['ok'])||!hash_equals($_SESSION['csrf'],(string)$_POST['csrf']))throw new Exception('درخواست نامعتبر');
$src=trim((string)$_POST['download_source']);$u=parse_url($src);if(!$u||($u['scheme']??'')!=='https'||!in_array($u['host']??'',['seskia.online','www.seskia.online'],true))throw new Exception('منبع دانلود مجاز نیست');
foreach(['telegram','bale'] as $p){$t=trim((string)$_POST[$p.'_token']);$ch=trim((string)$_POST[$p.'_chat_id']);if($t!=='')$d[$p.'_token']=$t;if(!preg_match('/^-?\d{4,20}$/',$ch))throw new Exception('Chat ID نامعتبر');$d[$p.'_chat_id']=$ch;}$d['download_source']=$src;$x=C.'.tmp';file_put_contents($x,json_encode($d,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n",LOCK_EX);chmod($x,0600);rename($x,C);exec('sudo '.H.' 2>&1',$o,$rc);if($rc)throw new Exception('اعمال تنظیمات ناموفق بود');$msg='تنظیمات ذخیره و ربات‌ها راه‌اندازی مجدد شدند';}catch(Throwable $e){$err=$e->getMessage();}
$in=!empty($_SESSION['ok']);$d=$in?c():[];
?><!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مدیریت همکاره</title><link rel="icon" href="/favicon.svg"><style>*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#d9f3ee,transparent 30%),#edf3f6;color:#172b3a;font-family:Tahoma,Arial}.w{width:min(800px,calc(100% - 28px));margin:35px auto}.head{display:flex;align-items:center;gap:14px}.head img{width:64px}h1{color:#123f71}.card{background:#fff;border:1px solid #dce6ec;border-radius:26px;padding:26px;box-shadow:0 24px 70px #123f7118}.g{display:grid;grid-template-columns:1fr 1fr;gap:15px}.full{grid-column:1/-1}label{display:block;font-weight:bold;margin-bottom:7px}input{width:100%;height:50px;border:1px solid #dce6ec;border-radius:14px;padding:0 13px;font:inherit;direction:ltr}button{width:100%;height:52px;border:0;border-radius:14px;background:linear-gradient(135deg,#123f71,#176f92);color:#fff;font:inherit;font-weight:bold}.n{padding:12px;border-radius:12px;margin-bottom:14px;background:#e7f7f2}.bad{background:#fff0ee;color:#a5271d}@media(max-width:600px){.g{grid-template-columns:1fr}.full{grid-column:auto}}</style></head><body><main class="w"><header class="head"><img src="/logo.svg"><div><h1>پنل مدیریت همکاره</h1><p>مدیریت دانلود، تلگرام و بله</p></div></header><section class="card"><?php if($msg):?><div class="n"><?=$msg?></div><?php endif;?><?php if($err):?><div class="n bad"><?=htmlspecialchars($err)?></div><?php endif;?><?php if(!$in):?><form method="post"><label>رمز مدیریت</label><input name="password" type="password" required><input type="hidden" name="login" value="1"><br><br><button>ورود امن</button></form><?php else:?><form method="post" class="g" autocomplete="off"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><div class="full"><label>منبع فایل APK</label><input name="download_source" value="<?=htmlspecialchars($d['download_source'])?>" required></div><div><label>توکن جدید تلگرام</label><input name="telegram_token" type="password" placeholder="خالی = بدون تغییر"></div><div><label>Chat ID تلگرام</label><input name="telegram_chat_id" value="<?=htmlspecialchars($d['telegram_chat_id'])?>" required></div><div><label>توکن جدید بله</label><input name="bale_token" type="password" placeholder="خالی = بدون تغییر"></div><div><label>Chat ID بله</label><input name="bale_chat_id" value="<?=htmlspecialchars($d['bale_chat_id'])?>" required></div><div class="full"><button>ذخیره و اعمال</button><p>لینک عمومی همیشه adlisho.online/download.php می‌ماند.</p></div></form><?php endif;?></section></main></body></html>
PHP
chown root:www-data "$A";chmod 0640 "$A";php -l "$A";python3 -m py_compile "$H";nginx -t;systemctl reload php8.3-fpm nginx
code="$(curl -sS --resolve adlisho.online:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://adlisho.online/admin.php)"
[[ $code == 200 ]]||{ echo "Panel HTTP $code";exit 1;}
echo "✅ https://adlisho.online/admin.php"
echo "Backup: $BK"
