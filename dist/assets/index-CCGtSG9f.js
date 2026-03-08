(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))d(t);new MutationObserver(t=>{for(const n of t)if(n.type==="childList")for(const o of n.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&d(o)}).observe(document,{childList:!0,subtree:!0});function a(t){const n={};return t.integrity&&(n.integrity=t.integrity),t.referrerPolicy&&(n.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?n.credentials="include":t.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function d(t){if(t.ep)return;t.ep=!0;const n=a(t);fetch(t.href,n)}})();const w="modulepreload",y=function(r){return"/"+r},x={},m=function(e,a,d){let t=Promise.resolve();if(a&&a.length>0){document.getElementsByTagName("link");const o=document.querySelector("meta[property=csp-nonce]"),i=(o==null?void 0:o.nonce)||(o==null?void 0:o.getAttribute("nonce"));t=Promise.allSettled(a.map(s=>{if(s=y(s),s in x)return;x[s]=!0;const c=s.endsWith(".css"),u=c?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${s}"]${u}`))return;const l=document.createElement("link");if(l.rel=c?"stylesheet":w,c||(l.as="script"),l.crossOrigin="",l.href=s,i&&l.setAttribute("nonce",i),document.head.appendChild(l),c)return new Promise((b,v)=>{l.addEventListener("load",b),l.addEventListener("error",()=>v(new Error(`Unable to preload CSS for ${s}`)))})}))}function n(o){const i=new Event("vite:preloadError",{cancelable:!0});if(i.payload=o,window.dispatchEvent(i),!i.defaultPrevented)throw o}return t.then(o=>{for(const i of o||[])i.status==="rejected"&&n(i.reason);return e().catch(n)})};function g(r){const e=document.createElement("header");e.className="w-full flex flex-col z-50 sticky top-0";const a=document.createElement("div");a.className="w-full h-16 bg-black flex items-center justify-between px-4 md:px-6 border-b border-white/5 backdrop-blur-md bg-opacity-95";const d=document.createElement("div");d.className="flex items-center gap-8";const t=document.createElement("div");t.className="cursor-pointer hover:scale-110 transition-transform",t.innerHTML=`
        <div class="w-8 h-8 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-lg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="black"/>
                <path d="M2 17L12 22L22 17" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
    `;const n=document.createElement("nav");n.className="hidden lg:flex items-center gap-6 text-[13px] font-bold text-secondary",["Script","Characters","Scenes","Director","S-Class"].forEach(c=>{const u=document.createElement("a");if(u.textContent=c,u.className=`hover:text-white transition-all cursor-pointer relative group ${c==="Script"?"text-white":""}`,c==="Script"){const l=document.createElement("div");l.className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full",u.appendChild(l)}u.onclick=()=>{if(Array.from(n.children).forEach(l=>l.classList.remove("text-white")),u.classList.add("text-white"),r){const l=c.toLowerCase().replace(" ","-").replace("-class","class");r(l)}},n.appendChild(u)}),d.appendChild(t),d.appendChild(n);const i=document.createElement("div");i.className="flex items-center gap-4";const s=document.createElement("button");return s.className="p-2 text-secondary hover:text-white transition-colors",s.title="Update API Key",s.innerHTML=`
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3m-3-3l-2.25-2.25"/>
        </svg>
    `,s.onclick=()=>{localStorage.removeItem("muapi_key"),window.location.reload()},i.appendChild(s),a.appendChild(d),a.appendChild(i),e.appendChild(a),e}function E(){const r=document.createElement("div");r.className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto";const e=document.createElement("div");e.className="flex flex-col items-center mb-10",e.innerHTML=`
        <div class="mb-10 relative">
            <div class="w-24 h-24 bg-primary/10 rounded-3xl flex items-center justify-center border border-primary/20">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                </svg>
            </div>
        </div>
        <h1 class="text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4">Script Studio</h1>
        <p class="text-secondary text-sm font-medium opacity-60">Import scripts and generate shots with AI</p>
    `;const a=document.createElement("div");return a.className="w-full max-w-4xl bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8",a.innerHTML=`
        <div class="space-y-6">
            <div>
                <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Import Script</label>
                <textarea
                    id="script-input"
                    placeholder="Paste your script here... Episodes will be automatically detected and parsed."
                    class="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-5 text-white placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors min-h-[200px] resize-y font-mono text-sm"
                ></textarea>
            </div>

            <div class="flex gap-4">
                <button id="parse-btn" class="flex-1 bg-primary text-black font-black py-4 rounded-2xl hover:shadow-glow hover:scale-[1.02] active:scale-[0.98] transition-all">
                    Parse Script
                </button>
                <button id="generate-btn" class="flex-1 bg-white/10 text-white font-black py-4 rounded-2xl hover:bg-white/20 transition-all">
                    Generate Shots
                </button>
            </div>

            <div id="episodes-list" class="mt-8 space-y-3">
                <p class="text-secondary text-sm text-center">No episodes loaded yet</p>
            </div>
        </div>
    `,r.appendChild(e),r.appendChild(a),setTimeout(()=>{const d=r.querySelector("#parse-btn"),t=r.querySelector("#generate-btn"),n=r.querySelector("#script-input"),o=r.querySelector("#episodes-list");d.onclick=()=>{const i=n.value.trim();if(!i)return;const s=i.split(/\n\n+/).filter(c=>c.length>50);o.innerHTML=s.map((c,u)=>`
                <div class="bg-black/40 border border-white/5 rounded-xl p-4">
                    <h3 class="text-white font-bold mb-2">Episode ${u+1}</h3>
                    <p class="text-secondary text-sm line-clamp-3">${c.substring(0,200)}...</p>
                    <p class="text-primary text-xs mt-2">${Math.ceil(c.split(/\s+/).length/150)} scenes estimated</p>
                </div>
            `).join(""),d.textContent=`Parsed ${s.length} Episodes`,d.disabled=!0,d.classList.add("opacity-50")},t.onclick=()=>{t.innerHTML=`
                <svg class="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            `,setTimeout(()=>{t.textContent="Shots Generated!",t.classList.add("bg-primary","text-black"),t.classList.remove("bg-white/10")},2e3)}},100),r}const h=document.querySelector("#app");let p;function f(r){p&&(p.innerHTML="",r==="script"?p.appendChild(E()):r==="characters"?m(async()=>{const{CharacterStudio:e}=await import("./CharacterStudio-ChgcrrAc.js");return{CharacterStudio:e}},[]).then(({CharacterStudio:e})=>{p.appendChild(e())}):r==="scenes"?m(async()=>{const{SceneStudio:e}=await import("./SceneStudio-BVCDX2Vg.js");return{SceneStudio:e}},[]).then(({SceneStudio:e})=>{p.appendChild(e())}):r==="director"?m(async()=>{const{DirectorStudio:e}=await import("./DirectorStudio-BPq-ZWYQ.js");return{DirectorStudio:e}},[]).then(({DirectorStudio:e})=>{p.appendChild(e())}):r==="sclass"&&m(async()=>{const{SClassStudio:e}=await import("./SClassStudio-CmDmaJ2r.js");return{SClassStudio:e}},[]).then(({SClassStudio:e})=>{p.appendChild(e())}))}h.innerHTML="";h.appendChild(g(f));p=document.createElement("main");p.id="content-area";p.className="flex-1 relative w-full overflow-hidden flex flex-col bg-app-bg";h.appendChild(p);f("script");window.addEventListener("navigate",r=>{r.detail.page==="settings"?m(async()=>{const{SettingsModal:e}=await import("./SettingsModal-DqI1F9CK.js");return{SettingsModal:e}},[]).then(({SettingsModal:e})=>{document.body.appendChild(e())}):f(r.detail.page)});
