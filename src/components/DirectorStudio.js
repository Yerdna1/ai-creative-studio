export function DirectorStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto';

    container.innerHTML = `
        <div class="flex flex-col items-center mb-10">
            <div class="w-24 h-24 bg-red-500/10 rounded-3xl flex items-center justify-center border border-red-500/20 mb-6">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-red-400">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
            </div>
            <h1 class="text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4">Director Studio</h1>
            <p class="text-secondary text-sm font-medium opacity-60">Timeline and cinematography control</p>
        </div>

        <div class="w-full max-w-6xl bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8">
            <div class="mb-6">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-white text-xl font-bold">Timeline</h2>
                    <div class="flex gap-2">
                        <button class="px-4 py-2 bg-white/10 text-white text-sm rounded-lg hover:bg-white/20">+ Add Shot</button>
                        <button class="px-4 py-2 bg-red-500 text-black text-sm font-bold rounded-lg hover:shadow-glow">Generate Video</button>
                    </div>
                </div>

                <div class="space-y-2">
                    ${[1, 2, 3, 4, 5].map(i => `
                        <div class="flex items-center gap-4 bg-black/40 border border-white/5 rounded-xl p-4">
                            <div class="w-16 h-10 bg-gradient-to-br from-red-500/20 to-orange-500/20 rounded-lg flex items-center justify-center text-white font-bold">${i}</div>
                            <div class="flex-1">
                                <p class="text-white text-sm font-medium">Shot ${i}</p>
                                <p class="text-secondary text-xs">Duration: 3s • Camera: Wide angle</p>
                            </div>
                            <button class="text-secondary hover:text-white">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="1"/>
                                    <circle cx="12" cy="5" r="1"/>
                                    <circle cx="12" cy="19" r="1"/>
                                </svg>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="grid grid-cols-3 gap-4">
                <div>
                    <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Aspect Ratio</label>
                    <select class="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-white text-sm">
                        <option>16:9</option>
                        <option>9:16</option>
                        <option>4:3</option>
                    </select>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Duration</label>
                    <select class="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-white text-sm">
                        <option>5s</option>
                        <option>10s</option>
                        <option>15s</option>
                    </select>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Quality</label>
                    <select class="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-white text-sm">
                        <option>High</option>
                        <option>Basic</option>
                    </select>
                </div>
            </div>
        </div>
    `;

    return container;
}
