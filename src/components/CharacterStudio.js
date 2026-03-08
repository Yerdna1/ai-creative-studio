export function CharacterStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto';

    container.innerHTML = `
        <div class="flex flex-col items-center mb-10">
            <div class="w-24 h-24 bg-purple-500/10 rounded-3xl flex items-center justify-center border border-purple-500/20 mb-6">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-purple-400">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                </svg>
            </div>
            <h1 class="text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4">Character Studio</h1>
            <p class="text-secondary text-sm font-medium opacity-60">Generate AI characters with Character Bible</p>
        </div>

        <div class="w-full max-w-4xl bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Character Name</label>
                        <input type="text" placeholder="Enter character name" class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-purple-500/50">
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Gender</label>
                        <select class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white focus:outline-none">
                            <option>Male</option>
                            <option>Female</option>
                            <option>Other</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Age</label>
                        <input type="text" placeholder="e.g., 25-30" class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-purple-500/50">
                    </div>
                </div>

                <div class="space-y-4">
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Personality</label>
                        <textarea placeholder="Describe personality..." class="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white min-h-[120px] resize-y focus:outline-none focus:border-purple-500/50"></textarea>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Reference Images</label>
                        <div class="border-2 border-dashed border-white/10 rounded-2xl p-8 text-center hover:border-purple-500/30 transition-colors cursor-pointer">
                            <p class="text-secondary text-sm">Drop images or click to upload</p>
                        </div>
                    </div>
                </div>
            </div>

            <button class="w-full mt-6 bg-purple-500 text-black font-black py-4 rounded-2xl hover:shadow-glow hover:scale-[1.02] active:scale-[0.98] transition-all">
                Generate Character
            </button>
        </div>
    `;

    return container;
}
