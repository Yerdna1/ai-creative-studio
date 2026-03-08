export function SClassStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto';

    container.innerHTML = `
        <div class="flex flex-col items-center mb-10">
            <div class="w-24 h-24 bg-yellow-500/10 rounded-3xl flex items-center justify-center border border-yellow-500/20 mb-6">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-yellow-400">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
            </div>
            <h1 class="text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4">S-Class Studio</h1>
            <p class="text-secondary text-sm font-medium opacity-60">Seedance 2.0 video generation</p>
        </div>

        <div class="w-full max-w-4xl bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8">
            <div class="space-y-6">
                <div class="text-center py-8 bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-2xl">
                    <svg class="w-16 h-16 mx-auto mb-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <h3 class="text-white text-xl font-bold mb-2">Ready to Generate</h3>
                    <p class="text-secondary text-sm">All shots from Director will be processed with Seedance 2.0</p>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">First Frame Strategy</label>
                        <select class="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-white text-sm">
                            <option>Grid</option>
                            <option>Primary</option>
                            <option>Custom</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Prompt Fusion</label>
                        <select class="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-white text-sm">
                            <option>3-Layer</option>
                            <option>2-Layer</option>
                        </select>
                    </div>
                </div>

                <div class="flex items-center gap-3 bg-black/40 border border-white/5 rounded-xl p-4">
                    <input type="checkbox" id="audio-sync" checked class="rounded">
                    <label for="audio-sync" class="text-white text-sm">Enable Audio Sync</label>
                </div>

                <div class="bg-black/40 border border-white/5 rounded-xl p-4">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-secondary text-sm">Generation Progress</span>
                        <span class="text-primary text-sm font-bold">0%</span>
                    </div>
                    <div class="w-full bg-white/5 rounded-full h-2">
                        <div class="bg-gradient-to-r from-yellow-500 to-orange-500 h-2 rounded-full" style="width: 0%"></div>
                    </div>
                </div>

                <button class="w-full bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-black py-4 rounded-2xl hover:shadow-glow hover:scale-[1.02] active:scale-[0.98] transition-all">
                    Generate with Seedance 2.0
                </button>

                <div class="text-center">
                    <p class="text-secondary text-xs">Estimated time: 2-3 minutes for 5 shots</p>
                </div>
            </div>
        </div>
    `;

    return container;
}
