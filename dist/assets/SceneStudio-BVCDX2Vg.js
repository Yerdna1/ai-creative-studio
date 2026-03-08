function o(){const e=document.createElement("div");return e.className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto",e.innerHTML=`
        <div class="flex flex-col items-center mb-10">
            <div class="w-24 h-24 bg-blue-500/10 rounded-3xl flex items-center justify-center border border-blue-500/20 mb-6">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-blue-400">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
            </div>
            <h1 class="text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4">Scene Studio</h1>
            <p class="text-secondary text-sm font-medium opacity-60">Create multi-viewpoint scene images</p>
        </div>

        <div class="w-full max-w-4xl bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8">
            <div class="space-y-6">
                <div>
                    <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Scene Location</label>
                    <input type="text" placeholder="e.g., Modern office, Ancient temple" class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-blue-500/50">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Time of Day</label>
                        <select class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white focus:outline-none">
                            <option>Morning</option>
                            <option>Afternoon</option>
                            <option>Evening</option>
                            <option>Night</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Weather</label>
                        <select class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white focus:outline-none">
                            <option>Clear</option>
                            <option>Cloudy</option>
                            <option>Rainy</option>
                            <option>Snowy</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Scene Description</label>
                    <textarea placeholder="Describe the scene..." class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white min-h-[120px] resize-y focus:outline-none focus:border-blue-500/50"></textarea>
                </div>

                <div>
                    <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Viewpoints</label>
                    <div class="grid grid-cols-3 gap-3">
                        ${["Front","Side","Top","Low","Wide","Close"].map(t=>`
                            <label class="flex items-center gap-2 bg-black/40 border border-white/5 rounded-xl p-3 cursor-pointer hover:border-blue-500/30 transition-colors">
                                <input type="checkbox" class="rounded">
                                <span class="text-white text-sm">${t}</span>
                            </label>
                        `).join("")}
                    </div>
                </div>

                <button class="w-full bg-blue-500 text-black font-black py-4 rounded-2xl hover:shadow-glow hover:scale-[1.02] active:scale-[0.98] transition-all">
                    Generate Scene Viewpoints
                </button>
            </div>
        </div>
    `,e}export{o as SceneStudio};
