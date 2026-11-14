/**
 * The English intro page (src/app/about/route.ts), whole: exported from its design as it is, never edited by hand.
 * Not named template.ts, which Next.js takes for a segment's template.
 * Blanks {{name}} are filled by the route; <!--en:on-->…<!--/en:on--> is kept while the English site is on and
 * <!--en:off-->…<!--/en:off--> while it is off.
 */
export const INTRO_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{siteName}}: find Arknights and Endfield players near you</title>
<meta name="description" content="A free, unofficial fan map for Arknights and Endfield players. Put your roach on the map by hand, see who plays near you, and make Feeler Friends. No GPS. For players {{minAge}}+.">
<link rel="canonical" href="https://zhoupmap.com/about">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{{siteName}}">
<meta property="og:url" content="https://zhoupmap.com/about">
<meta property="og:title" content="Someone near you plays Arknights or Endfield too">
<meta property="og:description" content="A free, unofficial fan map for Arknights and Endfield players. Put your roach on the map and see who plays near you.">
<meta property="og:image" content="https://zhoupmap.com/intro-art/share.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-icon.png">
<meta name="theme-color" content="#ece9e1">
<style>
html{background:#ece9e1;-webkit-text-size-adjust:100%;text-size-adjust:100%}
img[loading=lazy]{height:auto}
body{margin:0}
a{color:#1b1d22}a:hover{color:#000000}
@keyframes ak-wa{0%{opacity:0;transform:translateY(.35em)}6%,44%{opacity:1;transform:translateY(0)}50%,100%{opacity:0;transform:translateY(-.35em)}}
@keyframes ak-wb{0%,50%{opacity:0;transform:translateY(.35em)}56%,94%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-.35em)}}
@keyframes ak-drop{0%{opacity:0;transform:translateY(-170%) scale(1,1)}6%{opacity:1;transform:translateY(0) scale(1,1)}8%{opacity:1;transform:translateY(0) scale(1.1,.88)}11%,92%{opacity:1;transform:translateY(0) scale(1,1)}97%,100%{opacity:0;transform:translateY(0) scale(1,1)}}
@keyframes ak-ring{0%,18%{opacity:0;transform:scale(.12)}30%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in10{0%,10%{opacity:0;transform:scale(.5)}13%{opacity:1;transform:scale(1.12)}16%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in15{0%,15%{opacity:0;transform:scale(.5)}18%{opacity:1;transform:scale(1.12)}21%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in25{0%,25%{opacity:0;transform:scale(.5)}28%{opacity:1;transform:scale(1.12)}31%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in30{0%,30%{opacity:0;transform:scale(.5)}33%{opacity:1;transform:scale(1.12)}36%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in35{0%,35%{opacity:0;transform:scale(.5)}38%{opacity:1;transform:scale(1.12)}41%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in40{0%,40%{opacity:0;transform:scale(.5)}43%{opacity:1;transform:scale(1.12)}46%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in45{0%,45%{opacity:0;transform:scale(.5)}48%{opacity:1;transform:scale(1.12)}51%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in50{0%,50%{opacity:0;transform:scale(.5)}53%{opacity:1;transform:scale(1.12)}56%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in55{0%,55%{opacity:0;transform:scale(.5)}58%{opacity:1;transform:scale(1.12)}61%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in60{0%,60%{opacity:0;transform:scale(.5)}63%{opacity:1;transform:scale(1.12)}66%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-in70{0%,70%{opacity:0;transform:scale(.5)}73%{opacity:1;transform:scale(1.12)}76%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-mail{0%{opacity:0;transform:translateY(-16px)}8%,90%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(8px)}}
@keyframes ak-type{0%,15%{width:0}45%,100%{width:4.62em}}
@keyframes ak-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes ak-ripple{0%,6%{opacity:0;transform:scale(.3)}8%{opacity:.9;transform:scale(.5)}24%,100%{opacity:0;transform:scale(1.7)}}
@keyframes ak-s3-me{0%,46%{opacity:.4}50%,96%{opacity:1}100%{opacity:.4}}
@keyframes ak-s3-base{0%,46%{opacity:0;transform:scale(.6)}52%,96%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.6)}}
@keyframes ak-s3-feel{0%,5%{stroke-dashoffset:100}14%,36%{stroke-dashoffset:0}44%,54%{stroke-dashoffset:100}63%,92%{stroke-dashoffset:0}98%,100%{stroke-dashoffset:100}}
@keyframes ak-s3-q{0%,14%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1.15)}19%,38%{opacity:1;transform:scale(1)}42%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-s3-x{0%,63%{opacity:0;transform:scale(.4)}66%{opacity:1;transform:scale(1.2)}68%,92%{opacity:1;transform:scale(1)}96%,100%{opacity:0;transform:scale(1)}}
@keyframes ak-s3-card{0%,62%{opacity:0;transform:translate(-80px,18px) scale(.6)}72%,92%{opacity:1;transform:translate(0,0) scale(1)}96%,100%{opacity:0;transform:translate(0,0) scale(1)}}
@keyframes ak-s3-a{0%,47%{background-color:#ffd23f}50%,97%{background-color:#ffffff}100%{background-color:#ffd23f}}
@keyframes ak-s3-b{0%,47%{background-color:#ffffff}50%,97%{background-color:#ffd23f}100%{background-color:#ffffff}}
@keyframes ak-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes ak-ping{0%,100%{opacity:.35}8%{opacity:1}40%{opacity:.35}}
@keyframes ak-hl{0%,24%{background-color:#ffd23f}25%,100%{background-color:#ffffff}}
@keyframes ak-pick{0%,19%{box-shadow:0 0 0 3px #ffd23f;transform:translateY(-3px)}20%,100%{box-shadow:0 0 0 0 rgba(255,210,63,0);transform:translateY(0)}}
@keyframes ak-hop{0%,14%,100%{transform:translateY(0)}6%{transform:translateY(-5px)}}
@keyframes ak-hop2{0%,58%,100%{transform:translateY(0)}68%{transform:translateY(-12px)}78%{transform:translateY(0)}84%{transform:translateY(-3px)}90%{transform:translateY(0)}}
@keyframes ak-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes ak-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.04,.95)}}
@keyframes ak-float{0%{opacity:0;transform:translateY(4px) scale(.6)}20%{opacity:1;transform:translateY(0) scale(1)}80%,100%{opacity:0;transform:translateY(-14px) scale(1)}}
@keyframes ak-flicker{0%,100%{transform:scale(1,1) rotate(0deg)}25%{transform:scale(1.06,.95) rotate(-3deg)}50%{transform:scale(.96,1.06) rotate(2deg)}75%{transform:scale(1.04,.98) rotate(-1deg)}}
@keyframes ak-twinkle{0%,100%{opacity:1;transform:scale(1) rotate(0deg)}50%{opacity:.6;transform:scale(.78) rotate(25deg)}}
@keyframes ak-t-fill{0%,4%{width:0}12%,22%{width:16.67%}34%,44%{width:50%}56%,90%{width:83.33%}96%,100%{width:0}}
@keyframes ak-t-b1{0%,11%{filter:grayscale(1);opacity:.45;transform:scale(.9)}14%{filter:grayscale(0);opacity:1;transform:scale(1.14)}17%,90%{filter:grayscale(0);opacity:1;transform:scale(1)}95%,100%{filter:grayscale(1);opacity:.45;transform:scale(.9)}}
@keyframes ak-t-b2{0%,33%{filter:grayscale(1);opacity:.45;transform:scale(.9)}36%{filter:grayscale(0);opacity:1;transform:scale(1.14)}39%,90%{filter:grayscale(0);opacity:1;transform:scale(1)}95%,100%{filter:grayscale(1);opacity:.45;transform:scale(.9)}}
@keyframes ak-t-b3{0%,55%{filter:grayscale(1);opacity:.45;transform:scale(.9)}58%{filter:grayscale(0);opacity:1;transform:scale(1.14)}61%,90%{filter:grayscale(0);opacity:1;transform:scale(1)}95%,100%{filter:grayscale(1);opacity:.45;transform:scale(.9)}}
.ak-gal{display:flex;align-items:flex-start;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;margin:0 -16px;padding:2px 16px 12px;scrollbar-width:thin}
.ak-gal>.ak-tile{position:relative;flex:0 0 84%;min-width:0;padding-top:12px;scroll-snap-align:center}
@container (min-width: 720px){.ak-gal{display:block;columns:3 240px;column-gap:22px;overflow:visible;margin:0;padding:2px 0 0}.ak-gal>.ak-tile{break-inside:avoid;margin:0 0 30px}.ak-swipe{display:none}}
@media (prefers-reduced-motion: reduce){[style*="animation"]{animation:none !important}}
</style>
{{grayStyle}}
</head>
<body>
<div style="container-type: inline-size; width: 100%; box-sizing: border-box; background: #ece9e1; color: #1b1d22; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased">
<div style="max-width: 1120px; margin: 0 auto; padding: 0 clamp(16px, 4cqi, 40px) clamp(28px, 4cqi, 48px); box-sizing: border-box">

<header style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 0">
<a href="/about" aria-label="{{siteName}}, home" style="display: inline-flex; align-items: center; gap: 8px; padding: 4px 16px 4px 4px; background: #1b1d22; color: #ffffff; border-radius: 999px; text-decoration: none; min-height: 44px; box-sizing: border-box; white-space: nowrap">
<span style="width: 36px; height: 36px; border-radius: 50%; background: #2b2d33; display: inline-flex; align-items: center; justify-content: center; flex: none"><img src="/intro-art/roach-cyan.svg" alt="" style="width: 32px; height: 32px; display: block"></span>
<span style="font-size: 17px; font-weight: 800; letter-spacing: -0.01em">{{siteName}}</span>
</a>
<nav aria-label="Site" style="display: flex; align-items: center; gap: 6px; white-space: nowrap">
<a href="/" lang="zh-CN" style="display: inline-flex; align-items: center; min-height: 44px; padding: 0 10px; font-size: 15px; font-weight: 700; color: #1b1d22; text-decoration: none">中文</a>
<a href="{{mapHref}}" style="display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; box-sizing: border-box; background: #ffd23f; color: #1b1d22; border: 2px solid #1b1d22; border-radius: 999px; font-size: 14px; font-weight: 800; text-decoration: none; white-space: nowrap">Open the map</a>
</nav>
</header>

<section style="display: flex; flex-wrap: wrap; align-items: center; gap: clamp(28px, 4cqi, 56px); padding: clamp(16px, 4cqi, 56px) 0 0">
<div style="flex: 1 1 440px; min-width: 0; display: flex; flex-direction: column; gap: 18px">
<div style="display: flex; align-items: center; gap: 10px; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #1b1d22"><span style="width: 11px; height: 11px; border-radius: 3px; background: #ffd23f; box-shadow: 0 0 0 1.5px #1b1d22; flex: none"></span><span>For Arknights &amp; Endfield players</span></div>
<h1 style="position: relative; margin: 0; font-size: clamp(36px, 5.4cqi, 62px); line-height: 1.04; font-weight: 800; letter-spacing: -0.025em"><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">Someone near you plays Arknights or Endfield too.</span><span aria-hidden="true">Someone near you plays <span style="display: inline-grid; justify-items: start"><span style="grid-area: 1 / 1; padding: 0 0.06em; background: linear-gradient(transparent 58%, #ffd23f 58%, #ffd23f 92%, transparent 92%); animation: ak-wa 6s ease-in-out -0.5s infinite">Arknights</span><span style="grid-area: 1 / 1; padding: 0 0.06em; opacity: 0; background: linear-gradient(transparent 58%, #ffd23f 58%, #ffd23f 92%, transparent 92%); animation: ak-wb 6s ease-in-out -0.5s infinite">Endfield</span></span> too.</span></h1>
<p style="margin: 0; max-width: 34em; font-size: clamp(17px, 1.6cqi, 19px); line-height: 1.6; color: #3b3d43">On {{siteName}}, every player is a little roach on one world map. Spot the roaches near you, tap one to say hi, or shout a Declaration to everyone within {{declKm}}&nbsp;km.</p>
<div style="display: flex; flex-wrap: wrap; gap: 12px; padding-top: 4px">
<a href="{{mapHref}}" style="display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 52px; padding: 0 24px; box-sizing: border-box; background: #ffd23f; color: #1b1d22; border: 2px solid #1b1d22; border-radius: 999px; font-size: 17px; font-weight: 800; text-decoration: none; box-shadow: 0 4px 0 #1b1d22">Open the map<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10 H15 M10.5 5.5 L15 10 L10.5 14.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg></a>
<a href="#how" style="display: inline-flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 22px; box-sizing: border-box; background: transparent; color: #1b1d22; border: 2px solid #1b1d22; border-radius: 999px; font-size: 17px; font-weight: 700; text-decoration: none">How it works</a>
</div>
<!--en:off-->
<p style="margin: 0; padding: 10px 14px; border-radius: 12px; background: #fbf8f1; border: 1.5px dashed rgba(27,29,34,0.4); font-size: 14px; line-height: 1.5; color: #3b3d43"><strong style="color: #1b1d22">Heads-up:</strong> the map&#39;s menus are in Chinese for now. The English version is on its way.</p>
<!--/en:off-->
<p style="margin: 0; font-size: 14px; color: #5d5a52">Free · For players {{minAge}}+ · No GPS: you place your roach by hand</p>
<div style="display: flex; align-items: center; gap: 12px">
<div style="display: flex; flex: none" aria-hidden="true">
<span style="width: 34px; height: 34px; border-radius: 50%; background: #fbf8f1; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img src="/intro-art/roach-pink.svg" alt="" style="width: 28px; height: 28px"></span>
<span style="width: 34px; height: 34px; margin-left: -10px; border-radius: 50%; background: #fbf8f1; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img src="/intro-art/roach-green.svg" alt="" style="width: 28px; height: 28px"></span>
<span style="width: 34px; height: 34px; margin-left: -10px; border-radius: 50%; background: #fbf8f1; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img src="/intro-art/roach-gold.svg" alt="" style="width: 28px; height: 28px"></span>
</div>
<p style="margin: 0; font-size: 15px; line-height: 1.4; font-weight: 700">100,000+ players joined in our first three weeks</p>
</div>
</div>

<div style="flex: 1 1 440px; min-width: 0; display: flex; flex-direction: column">
<div role="img" aria-label="A map dotted with roaches. Yours lands, shouts “I'll always love Amiya” to everyone within {{declKm}} km, and roaches nearby reply." style="position: relative; width: 100%; aspect-ratio: 5 / 4; border-radius: 24px; overflow: hidden; border: 2px solid #1b1d22; background: #ece9e1; box-shadow: 0 24px 48px rgba(27,29,34,0.18)">
<img src="/intro-art/map-hero.svg" alt="" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover">
<div style="position: absolute; left: 44%; top: 47%; width: 54%; aspect-ratio: 1 / 1; transform: translate(-50%, -50%)"><div style="width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%; border: 2px dashed #1b1d22; background: rgba(255,210,63,0.24); animation: ak-ring 10s ease-out -7s infinite"></div></div>
<div style="position: absolute; left: 16%; top: 25%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-clone.svg" alt="" style="width: 100%; display: block; animation: ak-bob 3.2s ease-in-out -1s infinite"></div>
<div style="position: absolute; left: 34%; top: 13%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-purple.svg" alt="" style="width: 100%; display: block"></div>
<div style="position: absolute; left: 90%; top: 31%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-cyan.svg" alt="" style="width: 100%; display: block; animation: ak-bob 2.8s ease-in-out -0.4s infinite"></div>
<div style="position: absolute; left: 75%; top: 27%; width: 9%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-friend.svg" alt="" style="width: 100%; display: block"></div>
<div style="position: absolute; left: 79%; top: 15%; transform: translate(-50%, -100%)"><svg width="14" height="13" viewBox="0 0 14 13" style="display: block; animation: ak-float 2.6s ease-out infinite"><path d="M7 12 C2 8.5 0.8 6 0.8 4 A3.1 3.1 0 0 1 7 3 A3.1 3.1 0 0 1 13.2 4 C13.2 6 12 8.5 7 12 Z" fill="#ff5c8a" stroke="#1b1d22" stroke-width="1.2"></path></svg></div>
<div style="position: absolute; left: 91%; top: 51%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-gold.svg" alt="" style="width: 100%; display: block"></div>
<div style="position: absolute; left: 85%; top: 73%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-clone.svg" alt="" style="width: 100%; display: block; animation: ak-bob 3.6s ease-in-out -2s infinite"></div>
<div style="position: absolute; left: 8%; top: 70%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-green.svg" alt="" style="width: 100%; display: block"></div>
<div style="position: absolute; left: 91%; top: 93%; width: 11%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-asleep.svg" alt="" style="width: 100%; display: block; transform-origin: 50% 90%; animation: ak-breathe 3.2s ease-in-out infinite"></div>
<div style="position: absolute; left: 20%; top: 46%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-orange.svg" alt="" style="width: 100%; display: block; animation: ak-bob 3s ease-in-out -1.6s infinite"></div>
<div style="position: absolute; left: 30%; top: 64%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-purple.svg" alt="" style="width: 100%; display: block"></div>
<div style="position: absolute; left: 63%; top: 40%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-pink.svg" alt="" style="width: 100%; display: block"></div>
<div style="position: absolute; left: 60%; top: 64%; width: 8%; transform: translate(-50%, -92%)"><img src="/intro-art/roach-cyan.svg" alt="" style="width: 100%; display: block; animation: ak-bob 3.4s ease-in-out -0.8s infinite"></div>
<div style="position: absolute; left: 66.5%; top: 32%; transform: translate(-50%, -100%)"><span style="display: flex; align-items: center; justify-content: center; width: 17px; height: 17px; box-sizing: border-box; border-radius: 5px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 900; line-height: 1; transform-origin: 50% 100%; animation: ak-in35 10s ease-out -7s infinite">!</span></div>
<div style="position: absolute; left: 33.5%; top: 56%; transform: translate(-50%, -100%)"><span style="display: flex; align-items: center; justify-content: center; width: 17px; height: 17px; box-sizing: border-box; border-radius: 5px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 900; line-height: 1; transform-origin: 50% 100%; animation: ak-in35 10s ease-out -7s infinite">!</span></div>
<div style="position: absolute; left: 23.5%; top: 38%; transform: translate(-50%, -100%)"><span style="display: flex; align-items: center; justify-content: center; width: 17px; height: 17px; box-sizing: border-box; border-radius: 5px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 900; line-height: 1; transform-origin: 50% 100%; animation: ak-in40 10s ease-out -7s infinite">!</span></div>
<div style="position: absolute; left: 63.5%; top: 56%; transform: translate(-50%, -100%)"><span style="display: flex; align-items: center; justify-content: center; width: 17px; height: 17px; box-sizing: border-box; border-radius: 5px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 900; line-height: 1; transform-origin: 50% 100%; animation: ak-in35 10s ease-out -7s infinite">!</span></div>
<div style="position: absolute; left: 71%; top: 47%; transform: translate(-50%, -50%)"><span style="display: block; padding: 1px 8px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 11px; font-weight: 800; line-height: 1.5; white-space: nowrap; animation: ak-in30 10s ease-out -7s infinite">{{declKm}}&nbsp;km</span></div>
<div style="position: absolute; left: 30%; top: 65%; transform: translateX(-50%)"><span style="display: block; padding: 2px 9px; border-radius: 999px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 11px; font-weight: 800; line-height: 1.4; white-space: nowrap; transform-origin: 50% 0; box-shadow: 0 3px 8px rgba(27,29,34,0.18); animation: ak-in50 10s ease-out -7s infinite">Same fave! Tap me</span></div>
<div style="position: absolute; left: 60%; top: 65%; transform: translateX(-50%)"><span style="display: block; padding: 2px 9px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 11px; font-weight: 800; line-height: 1.4; white-space: nowrap; transform-origin: 50% 0; box-shadow: 0 3px 8px rgba(27,29,34,0.18); animation: ak-in60 10s ease-out -7s infinite">Amiya is mine!</span></div>
<div style="position: absolute; left: 44%; top: 52%; width: 11%; transform: translate(-50%, -100%)">
<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; transform-origin: 50% 100%; animation: ak-drop 10s ease-out -7s infinite">
<span style="padding: 4px 10px; border-radius: 10px; background: #1b1d22; color: #ffffff; font-size: 12px; font-weight: 800; line-height: 1.35; white-space: nowrap; box-shadow: 0 4px 10px rgba(27,29,34,0.25); transform-origin: 50% 100%; animation: ak-in15 10s ease-out -7s infinite">“I&#39;ll always love Amiya”</span>
<span style="padding: 2px 9px; border-radius: 999px; background: #1b1d22; color: #ffd23f; font-size: 12px; font-weight: 800; line-height: 1.5; white-space: nowrap; transform-origin: 50% 100%; animation: ak-in10 10s ease-out -7s infinite">You</span>
<img src="/intro-art/roach-mine.svg" alt="" style="width: 100%; display: block">
</div>
</div>
<div style="position: absolute; top: 4%; right: 3%; display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 5px; background: #1b1d22; color: #ffffff; border-radius: 999px; font-size: 13px; line-height: 1.2">
<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="12" fill="#14403f"></circle><circle cx="13" cy="13" r="8" fill="none" stroke="#3fd0d4" stroke-width="1" opacity="0.7"></circle><circle cx="13" cy="13" r="4" fill="none" stroke="#3fd0d4" stroke-width="1" opacity="0.7"></circle><g style="transform-origin: 13px 13px; animation: ak-spin 3s linear infinite"><path d="M13 13 L13 1 A12 12 0 0 1 23.4 7 Z" fill="#3fd0d4" opacity="0.45"></path></g><circle cx="18" cy="8" r="1.6" fill="#ffd23f"></circle></svg>
<span><strong>Ark Radar</strong> <span style="color: #ffd23f">· 3 new faces</span></span>
</div>
</div>
<div style="position: relative; z-index: 1; align-self: flex-start; width: min(88%, 380px); box-sizing: border-box; margin: -64px 0 0 clamp(10px, 2.5cqi, 28px); padding: 14px 16px; background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 16px; box-shadow: 0 14px 30px rgba(27,29,34,0.2); display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #c23b22">Declaration · within {{declKm}} km</span>
<p style="margin: 0; font-size: 16px; line-height: 1.4; font-weight: 800">“I&#39;ll always love Amiya”</p>
<div style="display: flex; flex-wrap: wrap; gap: 6px">
<span style="padding: 4px 11px; border-radius: 999px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 700; animation: ak-in50 10s ease-out -7s infinite">Same fave! Tap me</span>
<span style="padding: 4px 11px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600; animation: ak-in60 10s ease-out -7s infinite">Amiya is mine!</span>
<span style="padding: 4px 11px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600; animation: ak-in70 10s ease-out -7s infinite">I&#39;ll always love Amiya too!</span>
</div>
</div>
</div>
</section>

<section id="talk" style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: clamp(30px, 4cqi, 42px)">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Around the internet</span>
<h2 style="margin: 0; font-size: clamp(28px, 3.4cqi, 42px); line-height: 1.12; font-weight: 800; letter-spacing: -0.02em">Players are talking about it</h2>
<p style="margin: 6px 0 0; max-width: 40em; font-size: 17px; line-height: 1.6; color: #3b3d43">Since the map opened in October 2026, players have shared it on X, Reddit, Korea&#39;s Ruliweb and China&#39;s Bilibili. Here are a few of those posts.</p>
</div>
<div class="ak-gal">
<div class="ak-tile" style="display: flex; flex-direction: column; gap: 8px; container-type: inline-size">
<iframe src="https://platform.twitter.com/embed/Tweet.html?id=2120355023007920599&amp;dnt=true&amp;theme=light&amp;lang=en" title="Post on X" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allowfullscreen style="display: block; width: 100%; height: 500px; height: max(480px, calc(306px + 58cqi)); border: 0; border-radius: 14px; background: #ffffff; box-shadow: 0 12px 26px rgba(27,29,34,0.10)"></iframe>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 4px; font-size: 13px; line-height: 1.4; color: #5d5a52"><span>On X · Nov 11, 2026</span><a href="https://x.com/bitoUtAkAtA/status/2120355023007920599" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 4px; min-height: 32px; color: #1b1d22; font-weight: 800; text-decoration: none">Open<svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a></div>
</div>
<div class="ak-tile" style="display: flex; flex-direction: column; gap: 8px">
<iframe srcdoc="&lt;!doctype html&gt;&lt;html lang=en&gt;&lt;meta name=referrer content=strict-origin-when-cross-origin&gt;&lt;style&gt;html,body{margin:0;height:100%}body{color:#1b1d22;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}object{display:block;width:100%;height:100%;border:0}.fb{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;background:#fff}.mk{width:40px;height:40px;border-radius:50%;background:#ff4500;display:flex;align-items:center;justify-content:center}.mk i{width:17px;height:12px;border-radius:50%;background:#fff}p{margin:0}.w{font-size:14px;line-height:1.3;color:#576f76}.w b{color:#1b1d22}.t{max-width:15em;font-size:18px;line-height:1.35;font-weight:800;letter-spacing:-.01em}a{display:inline-flex;align-items:center;gap:6px;min-height:40px;margin-top:4px;padding:0 16px;box-sizing:border-box;border:1.5px solid #1b1d22;border-radius:999px;color:#1b1d22;font-size:14px;font-weight:800;text-decoration:none}a:hover{background:#f6f7f8}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}&lt;/style&gt;&lt;object data='https://embed.reddit.com/r/arknights/comments/1xtpcwp/comment/19slrt5jlwqmb/?embed=true&amp;amp;depth=1&amp;amp;showmore=false&amp;amp;showmedia=true&amp;amp;theme=light' type=text/html title='Comment on r/arknights'&gt;&lt;div class=fb&gt;&lt;span class=mk aria-hidden=true&gt;&lt;i&gt;&lt;/i&gt;&lt;/span&gt;&lt;p class=w&gt;&lt;b&gt;r/arknights&lt;/b&gt; · Comment&lt;/p&gt;&lt;p class=t&gt;The map came up in a discussion on Reddit.&lt;/p&gt;&lt;a href='https://www.reddit.com/r/arknights/comments/1xtpcwp/comment/19slrt5jlwqmb/?context=1' target=_blank rel=noopener&gt;Read it on Reddit&lt;svg width=13 height=13 viewBox='0 0 20 20' aria-hidden=true style='flex:none'&gt;&lt;path d='M6 14 L14 6 M7.5 6 H14 V12.5' fill=none stroke=#1b1d22 stroke-width=2.4 stroke-linecap=round stroke-linejoin=round&gt;&lt;/path&gt;&lt;/svg&gt;&lt;span class=sr&gt;, opens in a new tab&lt;/span&gt;&lt;/a&gt;&lt;/div&gt;&lt;/object&gt;" title="Comment on r/arknights" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allowfullscreen style="display: block; width: 100%; height: 320px; border: 0; border-radius: 14px; background: #ffffff; box-shadow: 0 12px 26px rgba(27,29,34,0.10)"></iframe>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 4px; font-size: 13px; line-height: 1.4; color: #5d5a52"><span>On Reddit · r/arknights</span><a href="https://www.reddit.com/r/arknights/comments/1xtpcwp/comment/19slrt5jlwqmb/?context=1" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 4px; min-height: 32px; color: #1b1d22; font-weight: 800; text-decoration: none">Open<svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a></div>
</div>
<div class="ak-tile" style="display: flex; flex-direction: column; gap: 8px">
<iframe src="https://player.bilibili.com/player.html?isOutside=true&amp;bvid=BV13YWN6bEnR&amp;autoplay=0&amp;danmaku=0" title="Video on Bilibili" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allowfullscreen style="display: block; width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; border-radius: 14px; background: #000000; box-shadow: 0 12px 26px rgba(27,29,34,0.10)"></iframe>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 4px; font-size: 13px; line-height: 1.4; color: #5d5a52"><span>On Bilibili · Video</span><a href="https://www.bilibili.com/video/BV13YWN6bEnR/" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 4px; min-height: 32px; color: #1b1d22; font-weight: 800; text-decoration: none">Open<svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a></div>
</div>
<div class="ak-tile" style="display: flex; flex-direction: column; gap: 8px">
<a href="https://bbs.ruliweb.com/community/board/300143/read/77349478" target="_blank" rel="noopener" style="position: relative; display: flex; flex-direction: column; gap: 10px; padding: 16px 18px 14px; background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 14px; color: #1b1d22; text-decoration: none; box-shadow: 0 12px 26px rgba(27,29,34,0.10)">

<span style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px"><strong style="font-size: 20px; line-height: 1.1; font-weight: 800; letter-spacing: -0.02em">Ruliweb</strong><span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #5d5a52">Korea · Humor board</span></span>
<span lang="ko" style="font-size: 17px; line-height: 1.45; font-weight: 800; word-break: keep-all">명일방주)으음, 이렇게 독타들이 많구나</span>
<span style="font-size: 14px; line-height: 1.5; color: #5d5a52">Post title, roughly: &ldquo;Hmm, so this is how many Doctors there are.&rdquo;</span>
<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 800">Read it on Ruliweb<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></span>
</a>
<div style="padding: 0 4px; font-size: 13px; line-height: 1.4; color: #5d5a52">On Ruliweb · Forum post, in Korean</div>
</div>
<div class="ak-tile" style="display: flex; flex-direction: column; gap: 8px">
<iframe src="https://player.bilibili.com/player.html?isOutside=true&amp;bvid=BV1qxW86gELW&amp;autoplay=0&amp;danmaku=0" title="Video on Bilibili" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allowfullscreen style="display: block; width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; border-radius: 14px; background: #000000; box-shadow: 0 12px 26px rgba(27,29,34,0.10)"></iframe>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 4px; font-size: 13px; line-height: 1.4; color: #5d5a52"><span>On Bilibili · Video</span><a href="https://www.bilibili.com/video/BV1qxW86gELW/" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 4px; min-height: 32px; color: #1b1d22; font-weight: 800; text-decoration: none">Open<svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a></div>
</div>
</div>
<p class="ak-swipe" style="margin: 2px 0 0; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #5d5a52">Swipe for more &rarr;</p>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: clamp(26px, 3.4cqi, 38px)">
<span style="font-size: 15px; font-weight: 800; margin-right: 4px">More, in Chinese:</span>
<a href="https://www.msn.com/zh-cn/news/other/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F%E7%8E%A9%E5%AE%B6%E8%87%AA%E5%88%B6%E8%88%9F%E5%8F%8B%E5%9C%B0%E5%9B%BE-%E6%95%B010%E4%B8%87%E8%88%9F%E5%8F%8B%E4%BA%92%E7%9B%B8%E4%BC%B8%E5%87%BA%E8%A7%A6%E9%A1%BB-%E5%A1%AB%E6%BB%A1%E5%9C%B0%E5%9B%BE/ar-AA2hitWe" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; box-sizing: border-box; background: #ffffff; border: 1.5px solid #1b1d22; border-radius: 999px; color: #1b1d22; font-size: 14px; font-weight: 700; text-decoration: none">MSN<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a>
<a href="https://www.sohu.com/a/1099798153_122348420" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; box-sizing: border-box; background: #ffffff; border: 1.5px solid #1b1d22; border-radius: 999px; color: #1b1d22; font-size: 14px; font-weight: 700; text-decoration: none">Sohu<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a>
<a href="https://m.163.com/dy/article/LBFILPUN0526VGN7.html" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; box-sizing: border-box; background: #ffffff; border: 1.5px solid #1b1d22; border-radius: 999px; color: #1b1d22; font-size: 14px; font-weight: 700; text-decoration: none">NetEase<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a>
<a href="https://tieba.baidu.com/p/11186258188" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; box-sizing: border-box; background: #ffffff; border: 1.5px solid #1b1d22; border-radius: 999px; color: #1b1d22; font-size: 14px; font-weight: 700; text-decoration: none">Baidu Tieba<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" style="flex: none"><path d="M6 14 L14 6 M7.5 6 H14 V12.5" fill="none" stroke="#1b1d22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0">, opens in a new tab</span></a>
</div>
<p style="margin: 16px 0 0; font-size: 14px; line-height: 1.6; color: #5d5a52">Posts are shown with X&#39;s, Reddit&#39;s and Bilibili&#39;s own embeds, and belong to the people who made them. Spotted us somewhere else? <a href="{{privacyHref}}#contact" style="color: #1b1d22; font-weight: 700">Tell us</a>.</p>
</section>

<section id="how" style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: clamp(22px, 3cqi, 34px)">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">How it works</span>
<h2 style="margin: 0; font-size: clamp(28px, 3.4cqi, 42px); line-height: 1.12; font-weight: 800; letter-spacing: -0.02em">Three steps to your first Feeler Friend</h2>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 20px">

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; padding: 16px 16px 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="height: 156px; border-radius: 14px; background: #f1eee8; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box" aria-hidden="true">
<div style="width: 100%; max-width: 250px; box-sizing: border-box; background: #ffffff; border: 2px solid #1b1d22; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; box-shadow: 0 6px 0 rgba(27,29,34,0.12); animation: ak-mail 6s ease-out -4s infinite">
<div style="display: flex; align-items: center; gap: 7px; font-size: 12px; color: #5d5a52"><svg width="16" height="16" viewBox="0 0 20 20"><rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="#5d5a52" stroke-width="1.6"></rect><path d="M3.5 6 L10 10.8 L16.5 6" fill="none" stroke="#5d5a52" stroke-width="1.6" stroke-linejoin="round"></path></svg>no-reply@zhoupmap.com</div>
<div style="font-size: 13px; color: #3b3d43">Your verification code is:</div>
<div style="display: flex; align-items: center; gap: 2px; height: 36px; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 28px; font-weight: 800; letter-spacing: 0.16em"><span style="display: inline-block; overflow: hidden; white-space: nowrap; width: 4.62em; animation: ak-type 6s steps(6, end) -4s infinite">482913</span><span style="flex: none; width: 2px; height: 26px; background: #1b1d22; animation: ak-blink 1s linear infinite"></span></div>
</div>
</div>
<div style="display: flex; align-items: baseline; gap: 10px; padding: 0 4px"><span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 15px; font-weight: 800; color: #c23b22">01</span><h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Sign in with your email</h3></div>
<p style="margin: 0; padding: 0 4px; font-size: 16px; line-height: 1.6; color: #3b3d43">We&#39;ll send you a 6-digit verification code. No password needed, though you can set one later.</p>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; padding: 16px 16px 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="position: relative; height: 156px; border-radius: 14px; overflow: hidden; background: #ece9e1" aria-hidden="true">
<img width="800" height="560" loading="lazy" decoding="async" src="/intro-art/map-hero.svg" alt="" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; object-position: 35% 55%">
<div style="position: absolute; left: 50%; top: 70%; width: 78px; height: 22px; transform: translate(-50%, -50%)"><div style="width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%; border: 3px solid #ffd23f; opacity: 0; animation: ak-ripple 7s ease-out -5s infinite"></div></div>
<div style="position: absolute; left: 18%; top: 44%; transform: translate(-50%, -100%)"><div style="display: flex; flex-direction: column; align-items: center; gap: 1px; transform-origin: 50% 100%; animation: ak-in25 7s ease-out -5s infinite"><span style="padding: 0 6px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 10px; font-weight: 800; line-height: 1.5">School</span><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-clone.svg" alt="" style="width: 38px; display: block"></div></div>
<div style="position: absolute; left: 84%; top: 40%; transform: translate(-50%, -100%)"><div style="display: flex; flex-direction: column; align-items: center; gap: 1px; transform-origin: 50% 100%; animation: ak-in35 7s ease-out -5s infinite"><span style="padding: 0 6px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 10px; font-weight: 800; line-height: 1.5">Work</span><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-clone.svg" alt="" style="width: 38px; display: block"></div></div>
<div style="position: absolute; left: 80%; top: 95%; transform: translate(-50%, -100%)"><div style="display: flex; flex-direction: column; align-items: center; gap: 1px; transform-origin: 50% 100%; animation: ak-in45 7s ease-out -5s infinite"><span style="padding: 0 6px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 10px; font-weight: 800; line-height: 1.5">Mall</span><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-clone.svg" alt="" style="width: 38px; display: block"></div></div>
<div style="position: absolute; left: 50%; top: 72%; width: 60px; transform: translate(-50%, -100%)"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-mine.svg" alt="" style="width: 100%; display: block; transform-origin: 50% 100%; animation: ak-drop 7s ease-out -5s infinite"></div>
<div style="position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; background: #1b1d22; color: #ffffff; border-radius: 999px; font-size: 12px; font-weight: 700">
<span style="width: 22px; height: 22px; border-radius: 50%; background: #ffffff; display: inline-flex; align-items: center; justify-content: center"><svg width="16" height="16" viewBox="0 0 20 20"><path d="M4 9.5 L10 4.5 L16 9.5 V16 H4 Z" fill="none" stroke="#1b1d22" stroke-width="1.7" stroke-linejoin="round"></path><path d="M3 17 L17 3" stroke="#c23b22" stroke-width="2.2" stroke-linecap="round"></path></svg></span>Not your front door</div>
</div>
<div style="display: flex; align-items: baseline; gap: 10px; padding: 0 4px"><span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 15px; font-weight: 800; color: #c23b22">02</span><h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Put your roach on the map</h3></div>
<p style="margin: 0; padding: 0 4px; font-size: 16px; line-height: 1.6; color: #3b3d43">Place it by hand; we never ask for your GPS. Signed-in players can see where it sits, so pick a mall or a station near you, not your home. Add up to {{maxClones}} clones at school, at work or wherever you hang out. Nobody can tell they&#39;re yours.</p>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; padding: 16px 16px 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="position: relative; height: 156px; border-radius: 14px; background: #f1eee8; overflow: hidden" aria-hidden="true">
<div style="position: absolute; left: calc(50% - 64px); top: 100px; width: 74px; height: 16px; transform: translate(-50%, -50%)"><div style="width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%; background: #ffd23f; border: 2px solid #1b1d22; animation: ak-s3-base 8s ease-out -6.6s infinite"></div></div>
<div style="position: absolute; left: calc(50% - 64px); top: 102px; width: 62px; transform: translate(-50%, -100%)"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-cyan.svg" alt="" style="width: 100%; display: block; animation: ak-s3-me 8s linear -6.6s infinite"></div>
<div style="position: absolute; left: calc(50% + 64px); top: 102px; width: 62px; transform: translate(-50%, -100%)"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-pink.svg" alt="" style="width: 100%; display: block"></div>
<svg width="100" height="50" viewBox="0 0 100 50" style="position: absolute; left: 50%; top: 16px; transform: translateX(-50%); overflow: visible; animation: ak-s3-me 8s linear -6.6s infinite"><path d="M6 30 C24 -4 76 -4 94 30" pathLength="100" fill="none" stroke="#1b1d22" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset="0" style="animation: ak-s3-feel 8s ease-in-out -6.6s infinite"></path></svg>
<div style="position: absolute; left: calc(50% + 64px); top: 6px; transform: translateX(-50%)"><div style="display: flex; align-items: center; gap: 4px; padding: 2px 8px 2px 3px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 11px; font-weight: 800; line-height: 1.4; white-space: nowrap; box-shadow: 0 3px 8px rgba(27,29,34,0.18); animation: ak-s3-card 8s ease-out -6.6s infinite"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-cyan.svg" alt="" style="width: 16px; display: block">Dr. A</div></div>
<div style="position: absolute; left: calc(50% + 104px); top: 52px; transform: translate(-50%, -50%)"><span style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; box-sizing: border-box; border-radius: 7px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 14px; font-weight: 900; line-height: 1; opacity: 0; animation: ak-s3-q 8s ease-out -6.6s infinite">?</span></div>
<div style="position: absolute; left: calc(50% + 104px); top: 52px; transform: translate(-50%, -50%)"><span style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; box-sizing: border-box; border-radius: 7px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 14px; font-weight: 900; line-height: 1; animation: ak-s3-x 8s ease-out -6.6s infinite">!</span></div>
<div style="position: absolute; left: 0; right: 0; bottom: 12px; display: flex; justify-content: center; gap: 8px">
<span style="padding: 4px 12px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 700; animation: ak-s3-a 8s linear -6.6s infinite">Sneaky tap</span>
<span style="padding: 4px 12px; border-radius: 999px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 800; animation: ak-s3-b 8s linear -6.6s infinite">Bold tap</span>
</div>
</div>
<div style="display: flex; align-items: baseline; gap: 10px; padding: 0 4px"><span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 15px; font-weight: 800; color: #c23b22">03</span><h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Put out a feeler</h3></div>
<p style="margin: 0; padding: 0 4px; font-size: 16px; line-height: 1.6; color: #3b3d43">Open a roach and tap it. A sneaky tap only tells them a roach said hi; a bold tap shows them your profile card. Bold-tap each other and you&#39;re Feeler Friends.</p>
</article>

</div>
</section>

<section id="features" style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: clamp(22px, 3cqi, 34px)">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">On the map</span>
<h2 style="margin: 0; font-size: clamp(28px, 3.4cqi, 42px); line-height: 1.12; font-weight: 800; letter-spacing: -0.02em">Plenty to do once you&#39;re down there</h2>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 20px">

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="min-height: 190px; box-sizing: border-box; padding: 18px; background: #f1eee8; border-bottom: 2px dashed rgba(27,29,34,0.22); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px" aria-hidden="true">
<div style="max-width: 280px; box-sizing: border-box; padding: 10px 14px; background: #ffffff; border: 2px solid #1b1d22; border-radius: 14px; font-size: 16px; font-weight: 800; text-align: center; animation: ak-in10 8s ease-out -6s infinite">“Welcome home, Doctor”</div>
<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 300px">
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600; animation: ak-in25 8s ease-out -6s infinite">I&#39;m back!</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600; animation: ak-in35 8s ease-out -6s infinite">Good to have you back</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600; animation: ak-in45 8s ease-out -6s infinite">Not quitting this time. For real</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 700; animation: ak-in55 8s ease-out -6s infinite">Just came back too. Tap me</span>
</div>
</div>
<div style="padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Declarations</span>
<h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Say it to everyone within {{declKm}}&nbsp;km</h3>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Pick a line, like “Welcome home, Doctor”, and send it from any of your roaches. Doctors nearby answer with one of four replies written for that line. Nobody knows who sent it, and it stays up for {{declDays}}&nbsp;days. Events bring limited-time lines.</p>
</div>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="min-height: 190px; box-sizing: border-box; padding: 18px 14px; background: #f1eee8; border-bottom: 2px dashed rgba(27,29,34,0.22); display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 14px" aria-hidden="true">
<svg width="112" height="112" viewBox="0 0 132 132"><circle cx="66" cy="66" r="62" fill="#1b1d22"></circle><circle cx="66" cy="66" r="62" fill="none" stroke="#0d0e10" stroke-width="2"></circle><circle cx="66" cy="66" r="44" fill="none" stroke="#2f6e6a" stroke-width="1.5"></circle><circle cx="66" cy="66" r="24" fill="none" stroke="#2f6e6a" stroke-width="1.5"></circle><g style="transform-origin: 66px 66px; animation: ak-spin 4s linear infinite"><path d="M66 66 L66 4 A62 62 0 0 1 119.7 35 Z" fill="#3fd0d4" opacity="0.3"></path><path d="M66 66 L119.7 35" stroke="#3fd0d4" stroke-width="2"></path></g><circle cx="92" cy="40" r="4" fill="#ffd23f" style="animation: ak-ping 4s ease-out 3.5s infinite"></circle><circle cx="40" cy="86" r="3.5" fill="#ffd23f" style="animation: ak-ping 4s ease-out 1.6s infinite"></circle><circle cx="80" cy="99" r="3" fill="#3fd0d4" style="animation: ak-ping 4s ease-out 0.76s infinite"></circle><circle cx="34" cy="48" r="2.6" fill="#3fd0d4" style="animation: ak-ping 4s ease-out 2.34s infinite"></circle><circle cx="66" cy="66" r="4.5" fill="#ffffff"></circle></svg>
<div style="display: flex; flex-direction: column; gap: 4px; width: 158px">
<div style="display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1.5px dashed rgba(27,29,34,0.25); font-size: 13px"><span>Crawled in · 24 h</span><strong style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace">10–20</strong></div>
<div style="display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1.5px dashed rgba(27,29,34,0.25); font-size: 13px"><span>New faces</span><strong style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace">5–10</strong></div>
<div style="display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; font-size: 13px"><span>Declarations</span><strong style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace">20+</strong></div>
</div>
</div>
<div style="padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Ark Radar</span>
<h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">See what&#39;s stirring nearby</h3>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Scan up to {{radarKm}}&nbsp;km around your main roach: who crawled in and out in the last 24&nbsp;hours, new faces, and the feelers and Declarations going around. It only ever gives rough counts, never distances or directions.</p>
</div>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="min-height: 190px; box-sizing: border-box; padding: 18px; background: #f1eee8; border-bottom: 2px dashed rgba(27,29,34,0.22); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px" aria-hidden="true">
<div style="display: flex; gap: 10px">
<span style="position: relative; width: 54px; height: 54px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-cyan.svg" alt="" style="width: 46px"><span style="position: absolute; right: -7px; top: -7px; width: 20px; height: 20px; border-radius: 50%; background: #ffd23f; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-in15 8s ease-out -6s infinite"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2 L5 8.6 L9.6 3.6" fill="none" stroke="#1b1d22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span></span>
<span style="position: relative; width: 54px; height: 54px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/doctor.webp" alt="" style="width: 46px"><span style="position: absolute; right: -7px; top: -7px; width: 20px; height: 20px; border-radius: 50%; background: #ffd23f; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-in25 8s ease-out -6s infinite"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2 L5 8.6 L9.6 3.6" fill="none" stroke="#1b1d22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span></span>
<span style="position: relative; width: 54px; height: 54px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/endmin.webp" alt="" style="width: 46px"></span>
<span style="position: relative; width: 54px; height: 54px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/gugu.webp" alt="" style="width: 46px"><span style="position: absolute; right: -7px; top: -7px; width: 20px; height: 20px; border-radius: 50%; background: #ffd23f; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-in35 8s ease-out -6s infinite"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2 L5 8.6 L9.6 3.6" fill="none" stroke="#1b1d22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span></span>
</div>
<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 300px">
<span style="padding: 3px 10px; border-radius: 999px; background: #ffd23f; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 700; animation: ak-hl 8s linear 0s infinite">Snuggle</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 700; animation: ak-hl 8s linear 2s infinite">High-five</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 700; animation: ak-hl 8s linear 4s infinite">Borrow some luck</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 700; animation: ak-hl 8s linear 6s infinite">Sanity nudge</span>
</div>
<div style="display: flex; align-items: center; gap: 8px; width: 100%; max-width: 300px; box-sizing: border-box; padding: 6px 10px 6px 6px; background: #ffffff; border: 1.5px solid #1b1d22; border-radius: 10px; font-size: 12px">
<span style="flex: none; padding: 2px 8px; border-radius: 6px; background: #c23b22; color: #ffffff; font-weight: 800">Help</span>
<span style="flex: 1; min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Arknights · need clues 3 &amp; 5</span>
<span style="flex: none; color: #5d5a52">{{helpHours}} h</span>
</div>
</div>
<div style="padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Feeler Friends</span>
<h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Friends who play the same game</h3>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Feeler Friends see each other&#39;s roaches, clones included. Snuggle, high-five, borrow some luck or send a Sanity nudge to several at once. Short on clues or need a support? Post a help request: only friends who play the same game see it, and it&#39;s gone after {{helpHours}}&nbsp;hours.</p>
</div>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="min-height: 190px; box-sizing: border-box; padding: 16px 18px; background: #f1eee8; border-bottom: 2px dashed rgba(27,29,34,0.22); display: flex; align-items: center; justify-content: center" aria-hidden="true">
<div style="width: 100%; max-width: 300px; display: flex; flex-direction: column">
<div style="display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1.5px dashed rgba(27,29,34,0.22); font-size: 13.5px"><svg width="18" height="18" viewBox="0 0 20 20" style="flex: none; animation: ak-hop 5s ease-in-out 0s infinite"><path d="M10 18.5 C10 18.5 4 12 4 8 A6 6 0 0 1 16 8 C16 12 10 18.5 10 18.5 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.6"></path><circle cx="10" cy="8" r="2" fill="#1b1d22"></circle></svg><strong style="width: 92px; flex: none; white-space: nowrap">Amiya</strong><span style="color: #5d5a52">Rhode Island, USA</span></div>
<div style="display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1.5px dashed rgba(27,29,34,0.22); font-size: 13.5px"><svg width="18" height="18" viewBox="0 0 20 20" style="flex: none; animation: ak-hop 5s ease-in-out 1s infinite"><path d="M10 18.5 C10 18.5 4 12 4 8 A6 6 0 0 1 16 8 C16 12 10 18.5 10 18.5 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.6"></path><circle cx="10" cy="8" r="2" fill="#1b1d22"></circle></svg><strong style="width: 92px; flex: none; white-space: nowrap">Perlica</strong><span style="color: #5d5a52">Right by your roach</span></div>
<div style="display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1.5px dashed rgba(27,29,34,0.22); font-size: 13.5px"><svg width="18" height="18" viewBox="0 0 20 20" style="flex: none; animation: ak-hop 5s ease-in-out 2s infinite"><path d="M10 18.5 C10 18.5 4 12 4 8 A6 6 0 0 1 16 8 C16 12 10 18.5 10 18.5 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.6"></path><circle cx="10" cy="8" r="2" fill="#1b1d22"></circle></svg><strong style="width: 92px; flex: none; white-space: nowrap">Talulah</strong><span style="color: #5d5a52">Sun Island, Harbin</span></div>
<div style="display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1.5px dashed rgba(27,29,34,0.22); font-size: 13.5px"><svg width="18" height="18" viewBox="0 0 20 20" style="flex: none; animation: ak-hop 5s ease-in-out 3s infinite"><path d="M10 18.5 C10 18.5 4 12 4 8 A6 6 0 0 1 16 8 C16 12 10 18.5 10 18.5 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.6"></path><circle cx="10" cy="8" r="2" fill="#1b1d22"></circle></svg><strong style="width: 92px; flex: none; white-space: nowrap">Argent Flow</strong><span style="color: #5d5a52">On the road with Nuli</span></div>
<div style="display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13.5px"><svg width="18" height="18" viewBox="0 0 20 20" style="flex: none; animation: ak-hop 5s ease-in-out 4s infinite"><path d="M10 18.5 C10 18.5 4 12 4 8 A6 6 0 0 1 16 8 C16 12 10 18.5 10 18.5 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.6"></path><circle cx="10" cy="8" r="2" fill="#1b1d22"></circle></svg><strong style="width: 92px; flex: none; white-space: nowrap">Si</strong><span style="color: #5d5a52">An inn in Hongcun</span></div>
</div>
</div>
<div style="padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Guides</span>
<h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Characters live on the map too</h3>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Amiya runs the tutorial from Rhode Island (the one in the USA) and dances if you press her. Perlica keeps an eye on you. Talulah tends a bonfire your clones can sit by, Argent Flow rides from city to city with clones in tow, and Si stamps your book at her inn. Tap them and they&#39;ll tap you back once a day. They&#39;re characters we run, not real players.</p>
</div>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="min-height: 190px; box-sizing: border-box; padding: 14px 12px 16px; background: #f1eee8; border-bottom: 2px dashed rgba(27,29,34,0.22); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px" aria-hidden="true">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #5d5a52">Diplomacy series</span>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; max-width: 300px">
<div style="display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center"><img width="200" height="200" loading="lazy" decoding="async" src="/badges/trainee.svg" alt="" style="width: 62px; height: 62px; display: block; animation: ak-t-b1 8s ease-out -5.6s infinite"><span style="font-size: 11px; font-weight: 800; line-height: 1.25">Diplomat in Training</span></div>
<div style="display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center"><img width="200" height="200" loading="lazy" decoding="async" src="/badges/diplomat.svg" alt="" style="width: 62px; height: 62px; display: block; animation: ak-t-b2 8s ease-out -5.6s infinite"><span style="font-size: 11px; font-weight: 800; line-height: 1.25">Doctor Diplomat</span></div>
<div style="display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center"><img width="200" height="200" loading="lazy" decoding="async" src="/badges/ambassador.svg" alt="" style="width: 62px; height: 62px; display: block; animation: ak-t-b3 8s ease-out -5.6s infinite"><span style="font-size: 11px; font-weight: 800; line-height: 1.25">Ambassador Plenipotentiary</span></div>
</div>
<div style="position: relative; width: 100%; max-width: 300px; height: 10px; margin-top: 16px; box-sizing: border-box; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22">
<div style="position: absolute; left: 0; top: 0; bottom: 0; width: 83.33%; border-radius: 999px; background: #ff8db0; animation: ak-t-fill 8s ease-in-out -5.6s infinite"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-mine.svg" alt="" style="position: absolute; right: -12px; bottom: 3px; width: 24px; display: block"></div>
<span style="position: absolute; left: 16.67%; top: -1.5px; bottom: -1.5px; width: 2px; margin-left: -1px; background: #1b1d22"></span><span style="position: absolute; left: 50%; top: -1.5px; bottom: -1.5px; width: 2px; margin-left: -1px; background: #1b1d22"></span><span style="position: absolute; left: 83.33%; top: -1.5px; bottom: -1.5px; width: 2px; margin-left: -1px; background: #1b1d22"></span>
</div>
<div style="position: relative; width: 100%; max-width: 300px; height: 15px; font-size: 10.5px; font-weight: 700; line-height: 15px; color: #5d5a52"><span style="position: absolute; left: 16.67%; transform: translateX(-50%); white-space: nowrap">1 friend</span><span style="position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap">10 friends</span><span style="position: absolute; left: 83.33%; transform: translateX(-50%); white-space: nowrap">30 friends</span></div>
</div>
<div style="padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Titles</span>
<h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">{{badgeCount}} titles to earn</h3>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">For making friends, sending Declarations, visiting the guides, and a few sillier things. Wear your favorite under your name.</p>
</div>
</article>

<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="min-height: 190px; box-sizing: border-box; padding: 18px 12px; background: #f1eee8; border-bottom: 2px dashed rgba(27,29,34,0.22); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px" aria-hidden="true">
<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 7px">
<span style="width: 48px; height: 48px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 0 0 3px #ffd23f; animation: ak-pick 8s ease-in-out 0.0s infinite"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-cyan.svg" alt="" style="width: 40px"></span>
<span style="width: 48px; height: 48px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-pick 8s ease-in-out 1.6s infinite"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/doctor.webp" alt="" style="width: 40px"></span>
<span style="width: 48px; height: 48px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-pick 8s ease-in-out 3.2s infinite"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/endmin.webp" alt="" style="width: 40px"></span>
<span style="width: 48px; height: 48px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-pick 8s ease-in-out 4.8s infinite"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/imp.webp" alt="" style="width: 40px"></span>
<span style="width: 48px; height: 48px; border-radius: 12px; background: #ffffff; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center; animation: ak-pick 8s ease-in-out 6.4s infinite"><img width="256" height="256" loading="lazy" decoding="async" src="/avatars/gugu.webp" alt="" style="width: 40px"></span>
</div>
<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 300px">
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600">3 layouts</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600">5 map styles</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600">Main roaches only</span>
<span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 12px; font-weight: 600">Add to Home Screen</span>
</div>
</div>
<div style="padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Make it yours</span>
<h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Your roach, your map</h3>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Pick a look for your roach. Switch between three page layouts and five map styles; Light keeps busy maps smooth. Show only main roaches when you want to see who&#39;s really around, and add {{siteName}} to your home screen like an app.</p>
</div>
</article>

<article style="grid-column: 1 / -1; background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; padding: clamp(18px, 2.4cqi, 28px); box-shadow: 0 10px 28px rgba(27,29,34,0.08); display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-direction: column; gap: 6px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">And a few little rituals</span>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 18px">
<div style="display: flex; gap: 12px; align-items: flex-start">
<span style="flex: none; width: 56px; height: 56px; border-radius: 14px; background: #f1eee8; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center" aria-hidden="true"><img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-asleep.svg" alt="" style="width: 50px; transform-origin: 50% 85%; animation: ak-breathe 3.2s ease-in-out infinite"></span>
<div style="display: flex; flex-direction: column; gap: 3px"><h3 style="margin: 0; font-size: 17px; line-height: 1.3; font-weight: 800">Consume Alcohol</h3><p style="margin: 0; font-size: 15px; line-height: 1.55; color: #3b3d43">Your roach sleeps it off belly-up. Friends can tuck you in or leave a glass of water by your pillow.</p></div>
</div>
<div style="display: flex; gap: 12px; align-items: flex-start">
<span style="flex: none; width: 56px; height: 56px; border-radius: 14px; background: #f1eee8; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" style="animation: ak-hop 4s ease-in-out 0.5s infinite"><path d="M4 11 L12 4 L20 11 V20 H4 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.8" stroke-linejoin="round"></path><path d="M9.5 20 V14.5 H14.5 V20" fill="none" stroke="#1b1d22" stroke-width="1.8" stroke-linejoin="round"></path></svg></span>
<div style="display: flex; flex-direction: column; gap: 3px"><h3 style="margin: 0; font-size: 17px; line-height: 1.3; font-weight: 800">Welcome home</h3><p style="margin: 0; font-size: 15px; line-height: 1.55; color: #3b3d43">Back after a few days away? See who tapped you while you were gone.</p></div>
</div>
<div style="display: flex; gap: 12px; align-items: flex-start">
<span style="flex: none; width: 56px; height: 56px; border-radius: 14px; background: #f1eee8; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" style="transform-origin: 50% 90%; animation: ak-flicker 1.4s ease-in-out infinite"><path d="M12 3 C13 7 17 8.5 17 13.5 A5 5 0 0 1 7 13.5 C7 10.5 9 9.5 9.5 7 C11 8.5 11.5 9.5 11.5 11 C12.5 9.5 12.8 6 12 3 Z" fill="#ff9f43" stroke="#1b1d22" stroke-width="1.7" stroke-linejoin="round"></path></svg></span>
<div style="display: flex; flex-direction: column; gap: 3px"><h3 style="margin: 0; font-size: 17px; line-height: 1.3; font-weight: 800">Weekly Hot List</h3><p style="margin: 0; font-size: 15px; line-height: 1.55; color: #3b3d43">The operators Doctors shout about most, every week.</p></div>
</div>
<div style="display: flex; gap: 12px; align-items: flex-start">
<span style="flex: none; width: 56px; height: 56px; border-radius: 14px; background: #f1eee8; border: 2px solid #1b1d22; display: inline-flex; align-items: center; justify-content: center" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" style="animation: ak-twinkle 2.6s ease-in-out infinite"><path d="M12 3 L13.8 9.2 L20 11 L13.8 12.8 L12 19 L10.2 12.8 L4 11 L10.2 9.2 Z" fill="#b48cff" stroke="#1b1d22" stroke-width="1.7" stroke-linejoin="round"></path></svg></span>
<div style="display: flex; flex-direction: column; gap: 3px"><h3 style="margin: 0; font-size: 17px; line-height: 1.3; font-weight: 800">Secrets</h3><p style="margin: 0; font-size: 15px; line-height: 1.55; color: #3b3d43">A few things are hidden around the map. We won&#39;t say where.</p></div>
</div>
</div>
</article>

</div>
</section>

<section id="safety" style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="background: #1b1d22; color: #ffffff; border-radius: 28px; padding: clamp(24px, 5cqi, 56px); display: flex; flex-direction: column; gap: clamp(20px, 3cqi, 32px)">
<div style="display: flex; flex-direction: column; gap: 8px">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #ffd23f">Privacy &amp; safety</span>
<h2 style="margin: 0; font-size: clamp(28px, 3.4cqi, 42px); line-height: 1.12; font-weight: 800; letter-spacing: -0.02em">Find each other without giving yourself away</h2>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 22px 28px">
<div style="display: flex; gap: 12px; align-items: flex-start"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="flex: none; margin-top: 1px"><circle cx="13" cy="13" r="12" fill="#ffd23f"></circle><path d="M7.5 13.3 L11.2 17 L18.6 9.4" fill="none" stroke="#1b1d22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #c9ccd2"><strong style="color: #ffffff">No GPS, ever.</strong> Your roach goes exactly where you put it, and you can move it or take it back later.</p></div>
<div style="display: flex; gap: 12px; align-items: flex-start"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="flex: none; margin-top: 1px"><circle cx="13" cy="13" r="12" fill="#ffd23f"></circle><path d="M7.5 13.3 L11.2 17 L18.6 9.4" fill="none" stroke="#1b1d22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #c9ccd2"><strong style="color: #ffffff">Anonymous by default.</strong> Strangers see a roach, not a person, and your clones can&#39;t be traced back to you.</p></div>
<div style="display: flex; gap: 12px; align-items: flex-start"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="flex: none; margin-top: 1px"><circle cx="13" cy="13" r="12" fill="#ffd23f"></circle><path d="M7.5 13.3 L11.2 17 L18.6 9.4" fill="none" stroke="#1b1d22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #c9ccd2"><strong style="color: #ffffff">You choose who sees you.</strong> Your profile card only goes to people you bold-tap, and your UID stays hidden unless you turn sharing on.</p></div>
<div style="display: flex; gap: 12px; align-items: flex-start"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="flex: none; margin-top: 1px"><circle cx="13" cy="13" r="12" fill="#ffd23f"></circle><path d="M7.5 13.3 L11.2 17 L18.6 9.4" fill="none" stroke="#1b1d22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #c9ccd2"><strong style="color: #ffffff">Nothing to see signed out.</strong> Visitors who haven&#39;t signed in can&#39;t see anyone&#39;s roaches, only rough counts.</p></div>
<div style="display: flex; gap: 12px; align-items: flex-start"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="flex: none; margin-top: 1px"><circle cx="13" cy="13" r="12" fill="#ffd23f"></circle><path d="M7.5 13.3 L11.2 17 L18.6 9.4" fill="none" stroke="#1b1d22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #c9ccd2"><strong style="color: #ffffff">Block and report.</strong> Block someone and you vanish from each other&#39;s maps. Reports go only to the Admin, and nobody learns who sent them.</p></div>
<div style="display: flex; gap: 12px; align-items: flex-start"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="flex: none; margin-top: 1px"><circle cx="13" cy="13" r="12" fill="#ffd23f"></circle><path d="M7.5 13.3 L11.2 17 L18.6 9.4" fill="none" stroke="#1b1d22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #c9ccd2"><strong style="color: #ffffff">{{minAge}}+, and we forget.</strong> {{siteName}} is for players {{minAge}} and over. Taps, Declarations and moves are deleted after {{keepDays}}&nbsp;days.</p></div>
</div>
<a href="{{privacyHref}}" style="align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: #ffd23f; font-size: 16px; font-weight: 700; text-decoration: underline; text-underline-offset: 4px">Read the Privacy Notice<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10 H15 M10.5 5.5 L15 10 L10.5 14.5" fill="none" stroke="#ffd23f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg></a>
</div>
</section>

<section id="world" style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: clamp(22px, 3cqi, 34px)">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">Wherever you are</span>
<h2 style="margin: 0; font-size: clamp(28px, 3.4cqi, 42px); line-height: 1.12; font-weight: 800; letter-spacing: -0.02em">One map for every server</h2>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px">
<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; padding: clamp(18px, 2.4cqi, 28px); display: flex; flex-direction: column; gap: 12px; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="display: flex; align-items: center; gap: 12px"><svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" style="flex: none"><circle cx="12" cy="12" r="9.5" fill="#b7d3e9" stroke="#1b1d22" stroke-width="1.7"></circle><path d="M12 2.5 C8.5 6 8.5 18 12 21.5 M12 2.5 C15.5 6 15.5 18 12 21.5 M2.8 9.5 H21.2 M2.8 14.5 H21.2" fill="none" stroke="#1b1d22" stroke-width="1.4"></path></svg><h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Anywhere on Earth</h3></div>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">In mainland China the map comes from AMap. Everywhere else it&#39;s our own world map, built from OpenStreetMap data. Distances are in kilometers.</p>
<div style="display: flex; flex-direction: column; gap: 6px; margin-top: auto; padding-top: 12px; border-top: 2px dashed rgba(27,29,34,0.22); font-size: 15px">
<!--en:on-->
<div style="display: flex; justify-content: space-between; gap: 12px"><span style="color: #5d5a52">English</span><a href="/en" style="font-weight: 700; color: #1b1d22">zhoupmap.com/en</a></div>
<!--/en:on-->
<!--en:off-->
<div style="display: flex; justify-content: space-between; gap: 12px"><span style="color: #5d5a52">English</span><span style="font-weight: 700">Coming soon</span></div>
<!--/en:off-->
<div style="display: flex; justify-content: space-between; gap: 12px"><span style="color: #5d5a52">中文</span><a href="/" lang="zh-CN" style="font-weight: 700; color: #1b1d22">zhoupmap.com · 舟P地图</a></div>
</div>
</article>
<article style="background: #fbf8f1; border: 2px solid #1b1d22; border-radius: 20px; padding: clamp(18px, 2.4cqi, 28px); display: flex; flex-direction: column; gap: 12px; box-shadow: 0 10px 28px rgba(27,29,34,0.08)">
<div style="display: flex; align-items: center; gap: 12px"><svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" style="flex: none"><rect x="3" y="5" width="18" height="14" rx="3" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.7"></rect><path d="M7 10 H13 M7 14 H11" stroke="#1b1d22" stroke-width="1.7" stroke-linecap="round"></path><circle cx="16.5" cy="12" r="2" fill="#1b1d22"></circle></svg><h3 style="margin: 0; font-size: 21px; line-height: 1.25; font-weight: 800">Bring your UID from any server</h3></div>
<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Add your UID with its server. It stays hidden unless you choose to share it.</p>
<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 4px">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><strong style="width: 100%; font-size: 13px; letter-spacing: 0.02em">Arknights</strong><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">CN Official</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">CN Bilibili</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">Global</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">Japan</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">Korea</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">Taiwan</span></div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><strong style="width: 100%; font-size: 13px; letter-spacing: 0.02em">Endfield</strong><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">CN Official</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">CN Bilibili</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">Global · Asia</span><span style="padding: 3px 10px; border-radius: 999px; background: #ffffff; border: 1.5px solid #1b1d22; font-size: 13px; font-weight: 600">Global · Americas/Europe</span></div>
</div>
</article>
</div>
</section>

<section id="faq" style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: clamp(18px, 2.4cqi, 26px)">
<span style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #c23b22">FAQ</span>
<h2 style="margin: 0; font-size: clamp(28px, 3.4cqi, 42px); line-height: 1.12; font-weight: 800; letter-spacing: -0.02em">Good questions</h2>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 0 40px">
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">Is {{siteName}} official?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">No. It&#39;s an unofficial fan project, not affiliated with Hypergryph.</p></div>
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">Why roaches?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">It&#39;s an old joke among Chinese Arknights players: there are as many of us as there are roaches. We ran with it, so everyone on the map is a roach. Ours are cute, promise.</p></div>
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">Does it cost anything?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">No. It&#39;s free.</p></div>
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">Do I have to share my location?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">No. You place your roach by hand. Signed-in players can see where it sits, so put it somewhere public near you, not at home.</p></div>
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">Can people tell who I am?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Not from the map. Strangers only see an anonymous roach, your profile goes only to people you bold-tap, and the radar never gives distances or directions.</p></div>
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">I play on Global. Can I join?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Yes. Players from every Arknights and Endfield server are welcome.</p></div>
<div style="padding: 18px 0; border-top: 2px dashed rgba(27,29,34,0.25); display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; font-size: 18px; line-height: 1.35; font-weight: 800">Something&#39;s wrong. Who do I tell?</h3><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3b3d43">Report the roach or profile from its card, or use <a href="{{privacyHref}}#contact" style="color: #1b1d22; font-weight: 700">Contact and reports</a>.</p></div>
</div>
</section>

<section style="padding-top: clamp(64px, 9cqi, 112px)">
<div style="position: relative; overflow: hidden; background: #ffd23f; border: 2px solid #1b1d22; border-radius: 28px; padding: clamp(28px, 5cqi, 56px); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px; box-shadow: 0 6px 0 #1b1d22">
<div style="flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 10px">
<h2 style="margin: 0; font-size: clamp(30px, 4cqi, 48px); line-height: 1.08; font-weight: 800; letter-spacing: -0.02em">Your roach is waiting.</h2>
<p style="margin: 0; font-size: 17px; line-height: 1.55">Put it down, put out a feeler, and see who&#39;s nearby.</p>
<div style="display: flex; flex-wrap: wrap; gap: 12px; padding-top: 8px">
<a href="{{mapHref}}" style="display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 52px; padding: 0 24px; box-sizing: border-box; background: #1b1d22; color: #ffffff; border: 2px solid #1b1d22; border-radius: 999px; font-size: 17px; font-weight: 800; text-decoration: none">Open the map<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10 H15 M10.5 5.5 L15 10 L10.5 14.5" fill="none" stroke="#ffd23f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg></a>
<a href="/" lang="zh-CN" style="display: inline-flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 22px; box-sizing: border-box; background: transparent; color: #1b1d22; border: 2px solid #1b1d22; border-radius: 999px; font-size: 17px; font-weight: 700; text-decoration: none">中文版 · 舟P地图</a>
</div>
</div>
<div style="flex: 0 1 300px; display: flex; align-items: flex-end; justify-content: center; gap: 2px" aria-hidden="true">
<img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-green.svg" alt="" style="width: 56px; transform-origin: 50% 100%; animation: ak-hop2 2.8s ease-in-out 0.00s infinite">
<img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-pink.svg" alt="" style="width: 64px; transform-origin: 50% 100%; animation: ak-hop2 2.8s ease-in-out 0.15s infinite">
<img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-mine.svg" alt="" style="width: 96px; transform-origin: 50% 100%; animation: ak-hop2 2.8s ease-in-out 0.30s infinite">
<img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-cyan.svg" alt="" style="width: 64px; transform-origin: 50% 100%; animation: ak-hop2 2.8s ease-in-out 0.45s infinite">
<img width="64" height="64" loading="lazy" decoding="async" src="/intro-art/roach-purple.svg" alt="" style="width: 56px; transform-origin: 50% 100%; animation: ak-hop2 2.8s ease-in-out 0.60s infinite">
</div>
</div>
</section>

<footer style="padding-top: clamp(40px, 5cqi, 56px); display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 1.6; color: #5d5a52">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; color: #1b1d22; font-weight: 800">{{siteName}} <span lang="zh-CN" style="font-weight: 600; color: #5d5a52">舟P地图</span> <span style="font-weight: 600; color: #5d5a52">zhoupmap.com</span></div>
<p style="margin: 0">An unofficial fan project, not affiliated with Hypergryph. Arknights and Arknights: Endfield belong to Hypergryph.</p>
<div style="display: flex; flex-wrap: wrap; gap: 4px 18px">
<a href="{{privacyHref}}" style="display: inline-flex; align-items: center; min-height: 32px; color: #1b1d22; font-weight: 600">Privacy Notice</a>
<a href="{{privacyHref}}#contact" style="display: inline-flex; align-items: center; min-height: 32px; color: #1b1d22; font-weight: 600">Contact and reports</a>
<a href="/" lang="zh-CN" style="display: inline-flex; align-items: center; min-height: 32px; color: #1b1d22; font-weight: 600">中文</a>
</div>
</footer>

</div>
</div>
</body>
</html>
`;
