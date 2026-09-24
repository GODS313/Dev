// Millerenos design tokens (shared values with the Mini App, see docs/DESIGN_SYSTEM.md).
export const SITE_CSS = `
:root{--mx-ink:#0b1320;--mx-ink-2:#334155;--mx-muted:#64748b;--mx-bg:#ffffff;--mx-surface:#f5f7fa;--mx-border:#e2e8f0;
--mx-primary:#0f766e;--mx-primary-ink:#ffffff;--mx-accent:#b45309;--mx-focus:#2563eb;--mx-radius:14px;--mx-radius-sm:8px;
--mx-space:clamp(16px,2.5vw,24px);--mx-max:1080px;
--mx-font:system-ui,-apple-system,"Segoe UI",Roboto,"Vazirmatn","Noto Sans Arabic",Tahoma,sans-serif}
@media (prefers-color-scheme:dark){:root{--mx-ink:#e6edf6;--mx-ink-2:#c3cfdd;--mx-muted:#94a3b8;--mx-bg:#0b1320;--mx-surface:#111c2e;
--mx-border:#1f2d44;--mx-primary:#2dd4bf;--mx-primary-ink:#04201d;--mx-accent:#fbbf24;--mx-focus:#93c5fd}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--mx-font);color:var(--mx-ink);background:var(--mx-bg);line-height:1.65;font-size:17px}
a{color:var(--mx-primary)}a:focus-visible,button:focus-visible{outline:3px solid var(--mx-focus);outline-offset:2px;border-radius:4px}
.skip{position:absolute;inset-inline-start:-999px;top:8px;background:var(--mx-bg);padding:8px 12px;z-index:10}.skip:focus{inset-inline-start:8px}
.wrap{max-width:var(--mx-max);margin:0 auto;padding:0 var(--mx-space)}
header.site{border-bottom:1px solid var(--mx-border);background:var(--mx-bg)}
header.site .wrap{display:flex;align-items:center;gap:16px;min-height:64px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px;color:var(--mx-ink);text-decoration:none;letter-spacing:.2px}
nav.main{display:flex;gap:4px 16px;flex-wrap:wrap;margin-inline-start:auto}nav.main a{color:var(--mx-ink-2);text-decoration:none;padding:6px 2px}
nav.main a[aria-current=page]{color:var(--mx-primary);font-weight:600}
.lang{font-size:15px;border:1px solid var(--mx-border);border-radius:999px;padding:4px 12px;text-decoration:none;color:var(--mx-ink-2)}
.hero{padding:clamp(40px,8vw,88px) 0 clamp(24px,5vw,48px)}
.hero h1{font-size:clamp(30px,5.2vw,52px);line-height:1.15;margin:0 0 16px;letter-spacing:-.5px}
.lead{font-size:clamp(18px,2.2vw,21px);color:var(--mx-ink-2);max-width:62ch;margin:0 0 28px}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--mx-primary);color:var(--mx-primary-ink);padding:13px 22px;border-radius:999px;
text-decoration:none;font-weight:650;font-size:17px;min-height:48px}.btn:hover{filter:brightness(1.07)}
.note{display:block;margin-top:10px;color:var(--mx-muted);font-size:15px}
main section{padding:8px 0 20px}main h2{font-size:clamp(21px,2.8vw,27px);margin:28px 0 10px}
main ul{padding-inline-start:22px}main li{margin:6px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin:16px 0}
.card{background:var(--mx-surface);border:1px solid var(--mx-border);border-radius:var(--mx-radius);padding:20px}
.card h3{margin:0 0 6px}.price{font-size:30px;font-weight:750}.muted{color:var(--mx-muted)}
.badge{display:inline-block;font-size:13px;font-weight:650;border-radius:999px;padding:2px 10px;border:1px solid var(--mx-border)}
.badge.ok{color:#047857;border-color:#34d399}.badge.no{color:var(--mx-muted)}
table{border-collapse:collapse;width:100%;font-size:16px}th,td{text-align:start;padding:10px 8px;border-bottom:1px solid var(--mx-border);vertical-align:top}
.crumbs{font-size:14px;color:var(--mx-muted);padding-top:18px}.crumbs a{color:var(--mx-muted)}
footer.site{margin-top:56px;border-top:1px solid var(--mx-border);background:var(--mx-surface);font-size:15px}
footer.site .wrap{display:flex;gap:24px;flex-wrap:wrap;justify-content:space-between;padding-top:24px;padding-bottom:32px}
footer.site nav{display:flex;gap:14px;flex-wrap:wrap}footer.site a{color:var(--mx-ink-2)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
