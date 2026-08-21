const commands = [
  ["/price BTC", "قیمت لحظه‌ای بیت‌کوین"],
  ["/buy BTC 100", "خرید آزمایشی با ۱۰۰ تتر"],
  ["/sell BTC 0.002", "فروش آزمایشی مقدار مشخص"],
  ["/portfolio", "موجودی، سود و زیان و معاملات"],
  ["/pause", "توقف اضطراری معاملات"],
  ["/risk 2", "سقف ریسک هر معامله: ۲٪"],
];

const guardrails = [
  { title: "حالت آزمایشی", text: "هیچ سفارش واقعی به صرافی ارسال نمی‌شود." },
  { title: "فهرست مجاز", text: "فقط مدیران تعریف‌شده اجازه اجرای دستور دارند." },
  { title: "وب‌هوک امضاشده", text: "پیام‌های جعلی پیش از پردازش رد می‌شوند." },
  { title: "توقف اضطراری", text: "فرمان /pause هر معامله جدید را فوراً متوقف می‌کند." },
];

export default function Home() {
  return (
    <main dir="rtl" className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="صفحه اصلی آلفا ترید">
          <span className="brand-mark" aria-hidden="true">A</span><span>آلفا ترید</span>
        </a>
        <nav aria-label="منوی اصلی"><a href="#commands">دستورات</a><a href="#security">امنیت</a><a href="#setup">راه‌اندازی</a></nav>
        <span className="status-pill"><i /> Paper Trading</span>
      </header>

      <section id="top" className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span>●</span> ربات معامله‌گر تلگرام، امن و قابل کنترل</div>
          <h1>معامله را از تلگرام مدیریت کن؛ ریسک را از قبل محدود کن.</h1>
          <p>قیمت لحظه‌ای، خرید و فروش آزمایشی، گزارش سبد، توقف اضطراری و اعلان Slack؛ همه در یک ربات فارسی که برای اتصال امن به صرافی آماده شده است.</p>
          <div className="hero-actions"><a className="button primary" href="#commands">مشاهده دستورات</a><a className="button secondary" href="#setup">مراحل اتصال</a></div>
          <p className="fineprint">این نسخه ابزار آموزشی است و توصیه مالی یا تضمین سود نیست.</p>
        </div>

        <div className="terminal-card" aria-label="نمونه گفت‌وگو با ربات">
          <div className="terminal-head"><div><span className="avatar">AT</span><strong>Alpha Trade Bot</strong></div><span className="online">آنلاین</span></div>
          <div className="chat">
            <div className="message user">/buy BTC 100</div>
            <div className="message bot"><span className="message-icon">✓</span><div><strong>خرید آزمایشی ثبت شد</strong><dl><div><dt>دارایی</dt><dd>BTC</dd></div><div><dt>مبلغ</dt><dd>100 USDT</dd></div><div><dt>قیمت اجرا</dt><dd>بر اساس بازار</dd></div><div><dt>حالت</dt><dd className="safe">PAPER</dd></div></dl></div></div>
            <div className="message user">/portfolio</div>
            <div className="message bot compact"><span className="message-icon chart-icon">↗</span><div><strong>سبد آزمایشی</strong><p>موجودی و سابقه معاملات در پایگاه داده امن نگهداری می‌شود.</p></div></div>
          </div>
          <div className="terminal-foot"><span>/</span> یک دستور وارد کنید… <b>↵</b></div>
        </div>
      </section>

      <section className="metric-strip" aria-label="ویژگی‌های اصلی"><div><strong>24/7</strong><span>پاسخ‌گویی وب‌هوک</span></div><div><strong>&lt; 2%</strong><span>ریسک پیش‌فرض هر معامله</span></div><div><strong>6</strong><span>فرمان مدیریتی اصلی</span></div><div><strong>0</strong><span>سفارش واقعی در نسخه آزمایشی</span></div></section>

      <section id="commands" className="section">
        <div className="section-heading"><span>کنترل از داخل تلگرام</span><h2>دستورهای کوتاه، نتیجه واضح</h2><p>هر عملیات مهم یک پاسخ قابل بررسی و یک رکورد ماندگار دارد.</p></div>
        <div className="command-grid">{commands.map(([command, description]) => <article className="command-card" key={command}><code>{command}</code><p>{description}</p><span aria-hidden="true">←</span></article>)}</div>
      </section>

      <section id="security" className="section security-section">
        <div className="section-heading align-start"><span>لایه‌های محافظتی</span><h2>اول کنترل، بعد معامله</h2><p>یک پیام تکراری، کاربر ناشناس یا تنظیم اشتباه نباید بتواند سفارش ایجاد کند.</p></div>
        <div className="guard-grid">{guardrails.map((item, index) => <article key={item.title}><b>0{index + 1}</b><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
      </section>

      <section id="setup" className="setup-panel">
        <div><span className="setup-kicker">آماده راه‌اندازی</span><h2>سه اتصال تا ربات شخصی شما</h2><p>توکن ربات تلگرام، شناسه مدیر و مقصد هشدار Slack به‌صورت متغیر امن ثبت می‌شوند؛ هیچ رازی داخل کد قرار نمی‌گیرد.</p></div>
        <ol><li><b>۱</b><span><strong>ساخت ربات</strong> از BotFather و دریافت توکن</span></li><li><b>۲</b><span><strong>تعریف مدیر</strong> با Telegram Chat ID مجاز</span></li><li><b>۳</b><span><strong>فعال‌سازی وب‌هوک</strong> و تست فرمان /start</span></li></ol>
      </section>

      <footer><div className="brand"><span className="brand-mark" aria-hidden="true">A</span><span>آلفا ترید</span></div><p>معامله آزمایشی هوشمند، با کنترل کامل شما.</p><span>نسخه 0.1 · Paper Trading</span></footer>
    </main>
  );
}
